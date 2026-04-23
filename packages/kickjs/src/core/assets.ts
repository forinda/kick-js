/**
 * Asset manager runtime (assets-plan.md PR 3).
 *
 * Three accessor surfaces over one resolver engine:
 *
 * - `assets.x.y()`        — Proxy ambient, autocomplete-friendly default.
 * - `useAssets()`         — hook returning the same Proxy; mockable per-call.
 * - `resolveAsset(ns, k)` — string resolver for dynamic dispatch.
 *
 * Resolution path:
 *
 * 1. Load the build-time manifest (`<outDir>/.kickjs-assets.json`)
 *    when present. Manifest existence = "we're running from a built
 *    dist". Fast path; mapped paths returned verbatim.
 * 2. Otherwise (dev / test) walk the assetMap src directories from
 *    `kick.config.{json,js,cjs}` and synthesise the same manifest
 *    shape in memory. First call pays the walk cost; subsequent
 *    calls hit the cache.
 * 3. `KICK_ASSETS_ROOT` env var overrides everything — the resolver
 *    treats the path as the manifest directory and skips discovery.
 *
 * @module @forinda/kickjs/core/assets
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { extname, isAbsolute, join, resolve, sep } from 'node:path'
import { createToken, type InjectionToken } from './token'

export const ASSET_MANIFEST_VERSION = 1 as const

interface AssetManifest {
  version: typeof ASSET_MANIFEST_VERSION
  entries: Record<string, string>
}

interface ResolvedManifest {
  manifest: AssetManifest
  root: string
}

/**
 * Augmentable interface — `kick typegen` (assets-plan.md PR 4) emits
 * a `declare global` augmentation listing every namespace + key for
 * the project's `assetMap`. Adopters who haven't run typegen yet
 * still get a runtime-correct Proxy; only typed autocomplete waits
 * on the augmentation.
 */
export interface KickAssets {}

/**
 * DI token for the `assets` Proxy. Adopter code that wants to
 * receive assets via constructor injection registers via
 * `container.registerInstance(ASSETS, useAssets())` in `bootstrap()`
 * and injects with `@Inject(ASSETS)`.
 */
export const ASSETS: InjectionToken<KickAssets> = createToken<KickAssets>('kick/assets/Map')

export class UnknownAssetError extends Error {
  readonly namespace: string
  readonly key: string
  constructor(namespace: string, key: string) {
    super(
      `Unknown asset '${namespace}/${key}'. ` +
        `Make sure the namespace exists in kick.config.ts assetMap and that the file is present in the source directory.`,
    )
    this.name = 'UnknownAssetError'
    this.namespace = namespace
    this.key = key
  }
}

let manifestCache: ResolvedManifest | null | undefined = undefined

export function resolveAsset(namespace: string, key: string): string {
  const resolved = loadManifest()
  if (!resolved) {
    throw new UnknownAssetError(namespace, key)
  }
  const entry = resolved.manifest.entries[`${namespace}/${key}`]
  if (!entry) {
    throw new UnknownAssetError(namespace, key)
  }
  return isAbsolute(entry) ? entry : resolve(resolved.root, entry)
}

/** Reset the manifest cache. Tests use this; production code shouldn't need it. */
export function clearAssetCache(): void {
  manifestCache = undefined
}

function loadManifest(): ResolvedManifest | null {
  if (manifestCache !== undefined) return manifestCache
  manifestCache = discoverManifest()
  return manifestCache
}

function discoverManifest(): ResolvedManifest | null {
  const envRoot = process.env.KICK_ASSETS_ROOT
  if (envRoot) {
    const fromEnv = readBuiltManifest(envRoot)
    if (fromEnv) return fromEnv
  }

  const cwd = process.cwd()
  for (const candidate of ['dist', 'build', 'out']) {
    const found = readBuiltManifest(join(cwd, candidate))
    if (found) return found
  }

  return synthesiseDevManifest(cwd)
}

function readBuiltManifest(dir: string): ResolvedManifest | null {
  const path = join(dir, '.kickjs-assets.json')
  if (!existsSync(path)) return null
  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<AssetManifest>
    if (parsed.version !== ASSET_MANIFEST_VERSION) return null
    if (!parsed.entries || typeof parsed.entries !== 'object') return null
    return { manifest: parsed as AssetManifest, root: resolve(dir) }
  } catch {
    return null
  }
}

interface AssetMapConfigShape {
  assetMap?: Record<string, { src: string; dest?: string; glob?: string }>
  build?: { outDir?: string }
}

function synthesiseDevManifest(cwd: string): ResolvedManifest | null {
  const config = loadConfigSync(cwd)
  if (!config?.assetMap) return null

  const entries: Record<string, string> = {}
  // Per-namespace owner tracker — same collision semantics as the
  // build pipeline (last-write-wins by walk order, warn on collision).
  // Walk order is filesystem-dependent in dev so the "winner" isn't
  // strictly alphabetical, but the warning still surfaces the conflict
  // so adopters can fix it before shipping.
  const keyOwners = new Map<string, string>()
  for (const [namespace, entry] of Object.entries(config.assetMap)) {
    if (!entry || typeof entry.src !== 'string') continue
    const srcAbs = resolve(cwd, entry.src)
    if (!existsSync(srcAbs)) continue
    walkSync(srcAbs, srcAbs, (relPath, absPath) => {
      if (entry.glob && !matchesGlobLite(relPath, entry.glob, namespace)) return
      const logicalKey = `${namespace}/${stripExt(relPath)}`
      const previous = keyOwners.get(logicalKey)
      if (previous && previous !== relPath) {
        console.warn(
          `[kickjs/assets] Dev collision in '${namespace}': '${previous}' and '${relPath}' both flatten to key '${logicalKey}'. ` +
            `Resolved to '${relPath}'. Rename one of them or filter via assetMap.${namespace}.glob.`,
        )
      }
      keyOwners.set(logicalKey, relPath)
      entries[logicalKey] = absPath
    })
  }

  return { manifest: { version: ASSET_MANIFEST_VERSION, entries }, root: cwd }
}

const warnedGlobs = new Set<string>()

/**
 * Tiny glob matcher used only by dev manifest synthesis. Covers the
 * common assetMap glob patterns (`**\/*`, `**\/*.ext`,
 * `**\/*.{a,b}`). Anything exotic prints a one-time warning + falls
 * through to `**\/*` semantics rather than silently dropping files.
 *
 * The build pipeline (`packages/cli/src/asset-manager/build.ts`) uses
 * the full `glob` package; adopters who hit the dev-mode warning
 * should run `kick build:assets` to produce a real manifest.
 */
function matchesGlobLite(relPath: string, pattern: string, namespace: string): boolean {
  if (pattern === '**/*' || pattern === '**') return true
  const singleExt = /^\*\*\/\*\.(\w+)$/.exec(pattern)
  if (singleExt) return relPath.endsWith(`.${singleExt[1]}`)
  const braceExt = /^\*\*\/\*\.\{([^}]+)\}$/.exec(pattern)
  if (braceExt) {
    const exts = braceExt[1].split(',').map((e) => e.trim())
    return exts.some((ext) => relPath.endsWith(`.${ext}`))
  }
  const tag = `${namespace}::${pattern}`
  if (!warnedGlobs.has(tag)) {
    warnedGlobs.add(tag)
    console.warn(
      `[kickjs/assets] Dev-mode glob '${pattern}' on '${namespace}' isn't recognised by the lite matcher. ` +
        `Falling back to '**/*'. Run 'kick build:assets' to use the full glob engine.`,
    )
  }
  return true
}

function walkSync(root: string, dir: string, onFile: (rel: string, abs: string) => void): void {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      walkSync(root, full, onFile)
    } else if (entry.isFile()) {
      const rel = full
        .slice(root.length + 1)
        .split(sep)
        .join('/')
      onFile(rel, full)
    }
  }
}

function stripExt(path: string): string {
  const ext = extname(path)
  return ext ? path.slice(0, -ext.length) : path
}

/**
 * Sync `kick.config.{json,cjs,js}` loader for dev manifest
 * synthesis. Avoids dynamic `import()` (would force every assets
 * lookup to be async). TypeScript configs (`kick.config.ts`) are
 * skipped here — adopters who use them should run `kick build:assets`
 * to produce a real manifest the resolver can read.
 */
function loadConfigSync(cwd: string): AssetMapConfigShape | null {
  const jsonPath = join(cwd, 'kick.config.json')
  if (existsSync(jsonPath)) {
    try {
      return JSON.parse(readFileSync(jsonPath, 'utf-8')) as AssetMapConfigShape
    } catch {
      return null
    }
  }
  for (const filename of ['kick.config.cjs', 'kick.config.js']) {
    const path = join(cwd, filename)
    if (!existsSync(path)) continue
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createRequire } = require('node:module') as typeof import('node:module')
      const req = createRequire(join(cwd, 'package.json'))
      const mod = req(path) as { default?: AssetMapConfigShape } & AssetMapConfigShape
      return mod.default ?? mod ?? null
    } catch {
      continue
    }
  }
  return null
}

const RESERVED_KEYS: ReadonlySet<string | symbol> = new Set<string | symbol>([
  'then',
  'toString',
  'valueOf',
  'constructor',
  'prototype',
  'name',
  'length',
  'asymmetricMatch',
  'nodeType',
  Symbol.toPrimitive,
  Symbol.toStringTag,
  Symbol.iterator,
  Symbol.asyncIterator,
])

function createNamespaceProxy(parts: readonly string[]): unknown {
  const target = function () {} as unknown as Record<string, unknown>
  return new Proxy(target, {
    apply() {
      if (parts.length < 2) {
        throw new UnknownAssetError(parts[0] ?? '', '')
      }
      const [namespace, ...rest] = parts
      return resolveAsset(namespace, rest.join('/'))
    },
    get(_, prop) {
      if (RESERVED_KEYS.has(prop)) return undefined
      if (typeof prop === 'symbol') return undefined
      return createNamespaceProxy([...parts, prop])
    },
  })
}

function createAssetProxy(): KickAssets {
  return new Proxy({} as Record<string, unknown>, {
    get(_, prop) {
      if (RESERVED_KEYS.has(prop)) return undefined
      if (typeof prop === 'symbol') return undefined
      return createNamespaceProxy([prop])
    },
  }) as unknown as KickAssets
}

/**
 * Variant A — the ambient Proxy. Default accessor for static call
 * sites where the namespace + key are literals known at compile time.
 *
 * @example
 * ```ts
 * import { assets } from '@forinda/kickjs'
 * const path = assets.mails.welcome()
 * ```
 */
export const assets: KickAssets = createAssetProxy()

/**
 * Variant B — the hook accessor. Returns the same Proxy as `assets`;
 * factory shape exists for testability + DI. Mock via
 * `vi.mock('@forinda/kickjs', () => ({ useAssets: () => fakeAssets }))`.
 *
 * @example
 * ```ts
 * import { useAssets } from '@forinda/kickjs'
 * class MailService {
 *   private assets = useAssets()
 *   send(name: string) {
 *     return ejs.renderFile(this.assets.mails[name](), {})
 *   }
 * }
 * ```
 */
export function useAssets(): KickAssets {
  return assets
}
