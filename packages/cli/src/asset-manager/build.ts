/**
 * Build pipeline for `assetMap` entries (asset-manager PR 2).
 *
 * For each entry, walks `src/<...>` matching the configured `glob`,
 * copies matches into `dest` (default `dist/<name>/`), then emits a
 * `dist/.kickjs-assets.json` manifest mapping logical
 * `<namespace>/<key>` keys to repo-relative paths inside `dist/`.
 *
 * Pure function on top of `node:fs` + `glob` — no shell, no side
 * effects beyond the configured directory writes. The build entry-
 * point in `commands/run.ts` calls `buildAssets` after the existing
 * `copyDirs` step.
 *
 * @module @forinda/kickjs-cli/asset-manager/build
 */

import { cpSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { glob } from 'glob'
import type { AssetMapEntry, KickConfig } from '../config'

/** Wire-format version for `dist/.kickjs-assets.json`. Bump on shape change. */
export const ASSET_MANIFEST_VERSION = 1 as const

/** On-disk manifest format (`dist/.kickjs-assets.json`). */
export interface AssetManifest {
  version: typeof ASSET_MANIFEST_VERSION
  /**
   * Logical key → manifest-relative path. Logical key is
   * `<namespace>/<key>` where `<key>` is the file path under `src`
   * with the extension stripped + path separators normalised.
   *
   * Path values are relative to the manifest file's directory so the
   * runtime can resolve them with a single `path.resolve(manifestDir,
   * entry)` regardless of where dist/ lives.
   */
  entries: Record<string, string>
}

export interface BuildAssetsOptions {
  /** Project root — resolved for every relative path in the entry. */
  cwd: string
  /**
   * Output dir for the manifest + per-namespace asset copies. When
   * omitted, falls back to `config.build?.outDir` (resolved against
   * `cwd`), then to `dist/` under cwd. Adopters with a custom Vite
   * `build.outDir` should set `kick.config.ts.build.outDir` to match.
   */
  distDir?: string
  /** Suppress per-entry log lines. Default: false. */
  silent?: boolean
}

/** One entry in the per-build summary returned by `buildAssets`. */
export interface BuildAssetsEntryResult {
  namespace: string
  src: string
  dest: string
  /** Number of files matched + copied. */
  filesCopied: number
}

/** Aggregated outcome of `buildAssets`. */
export interface BuildAssetsResult {
  manifestPath: string
  entries: BuildAssetsEntryResult[]
  /** `entries` merged into a single record — useful for tests + tooling. */
  manifest: AssetManifest
}

/**
 * Run the full asset build for a loaded config:
 *
 * 1. For each `assetMap` entry, glob → copy → manifest stub.
 * 2. Write `dist/.kickjs-assets.json`.
 *
 * Returns a summary including the manifest contents. No-op (and no
 * manifest written) when `assetMap` is empty / missing — the build
 * pipeline shouldn't litter `dist/` with empty manifests for
 * adopters who don't use the feature.
 */
export async function buildAssets(
  config: KickConfig | null,
  opts: BuildAssetsOptions,
): Promise<BuildAssetsResult | null> {
  const { cwd, silent = false } = opts
  // Resolution order: explicit opts.distDir → config.build.outDir → 'dist'.
  // The CLI build command passes nothing explicit, so adopters control
  // the output via kick.config.ts.build.outDir alone.
  const distDir = opts.distDir ?? config?.build?.outDir ?? 'dist'
  const map = config?.assetMap
  if (!map || Object.keys(map).length === 0) return null

  const log = silent ? () => {} : console.log

  const distAbs = resolve(cwd, distDir)
  mkdirSync(distAbs, { recursive: true })

  const summary: BuildAssetsEntryResult[] = []
  const manifestEntries: Record<string, string> = {}

  for (const [namespace, entry] of Object.entries(map)) {
    const result = await processEntry(namespace, entry, cwd, distAbs)
    summary.push(result.entrySummary)
    Object.assign(manifestEntries, result.manifestSlice)
    log(
      `    ✓ ${namespace}: ${result.entrySummary.filesCopied} file(s) → ${result.entrySummary.dest}`,
    )
  }

  const manifest: AssetManifest = {
    version: ASSET_MANIFEST_VERSION,
    entries: manifestEntries,
  }
  const manifestPath = join(distAbs, '.kickjs-assets.json')
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8')
  log(
    `    ✓ wrote manifest → ${relative(cwd, manifestPath)} (${Object.keys(manifestEntries).length} entries)`,
  )

  return { manifestPath, entries: summary, manifest }
}

/** Per-entry inner pipeline — extracted for unit-test reuse. */
async function processEntry(
  namespace: string,
  entry: AssetMapEntry,
  cwd: string,
  distAbs: string,
): Promise<{
  entrySummary: BuildAssetsEntryResult
  manifestSlice: Record<string, string>
}> {
  const srcAbs = resolve(cwd, entry.src)
  const destAbs = entry.dest ? resolve(cwd, entry.dest) : join(distAbs, namespace)

  // Defensive: refuse to write outside the project root (cwd) even
  // though validateAssetMap warned about it at config-load time. The
  // build step shouldn't trust upstream warnings — a typo like
  // `dest: '../../'` would otherwise sprinkle files outside the
  // workspace despite the warning being printed.
  if (escapesRoot(destAbs, cwd)) {
    console.warn(
      `  ⚠ assetMap.${namespace}.dest ('${entry.dest}') resolves outside the project root — skipping copy`,
    )
    return {
      entrySummary: { namespace, src: entry.src, dest: relative(cwd, destAbs), filesCopied: 0 },
      manifestSlice: {},
    }
  }

  // Treat src-not-a-directory the same as src-missing — `glob` would
  // throw if pointed at a file, surfacing as a generic build failure
  // instead of a clean 0-files entry. Matches the validator's warning
  // shape (already emitted at config-load time for the missing case).
  if (!existsSync(srcAbs) || !isDirectorySync(srcAbs)) {
    return {
      entrySummary: { namespace, src: entry.src, dest: relative(cwd, destAbs), filesCopied: 0 },
      manifestSlice: {},
    }
  }

  const pattern = entry.glob ?? '**/*'
  // `glob` returns paths relative to `cwd` when `cwd` is set —
  // exactly the slugs we want for the manifest keys.
  const matches = await glob(pattern, {
    cwd: srcAbs,
    nodir: true,
    dot: false,
    posix: true,
  })

  mkdirSync(destAbs, { recursive: true })

  const manifestSlice: Record<string, string> = {}
  // Track which source file currently owns each logical key so we can
  // surface a collision warning when two files in the same dir map to
  // the same `<basename>` (e.g. `index.html` + `index.js`). Sorted-input
  // order means last-alphabetical wins — deterministic + documented.
  const keyOwner = new Map<string, string>()
  for (const relPath of matches.sort()) {
    const srcFile = join(srcAbs, relPath)
    const destFile = join(destAbs, relPath)
    mkdirSync(dirname(destFile), { recursive: true })
    cpSync(srcFile, destFile)
    const logicalKey = `${namespace}/${stripExt(relPath)}`
    const previous = keyOwner.get(logicalKey)
    if (previous) {
      console.warn(
        `  ⚠ assetMap collision in '${namespace}': '${previous}' and '${relPath}' both flatten to key '${logicalKey}'. ` +
          `Last-alphabetical wins ('${relPath}'). Rename one of them or set assetMap.${namespace}.glob to filter by extension.`,
      )
    }
    keyOwner.set(logicalKey, relPath)
    manifestSlice[logicalKey] = toManifestRelative(distAbs, destFile)
  }

  return {
    entrySummary: {
      namespace,
      src: entry.src,
      dest: relative(cwd, destAbs),
      filesCopied: matches.length,
    },
    manifestSlice,
  }
}

/** Strip the final extension from a file path (`mails/welcome.ejs` → `mails/welcome`). */
function stripExt(path: string): string {
  const ext = extname(path)
  return ext ? path.slice(0, -ext.length) : path
}

/**
 * Make `destFile` relative to the manifest's directory + force POSIX
 * separators so the manifest is byte-stable across platforms.
 */
function toManifestRelative(manifestDir: string, destFile: string): string {
  const rel = relative(manifestDir, destFile)
  // path.relative returns OS-native separators; the manifest is JSON
  // and the runtime uses path.resolve which handles either, but a
  // forward-slash manifest is grep-friendly + diff-stable.
  return rel.split(/[\\/]/).filter(Boolean).join('/')
}

/**
 * Pure manifest writer — handy for tests that want to assert against
 * a hand-crafted manifest without exercising the full pipeline.
 */
export function writeAssetManifest(distDir: string, manifest: AssetManifest): string {
  const path = join(distDir, '.kickjs-assets.json')
  mkdirSync(distDir, { recursive: true })
  writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n', 'utf-8')
  return path
}

/**
 * Read + parse a manifest from disk. Returns `null` on missing or
 * malformed file rather than throwing — the runtime resolver wants
 * to fall through to dev-mode lookup in that case.
 */
export function readAssetManifest(distDir: string): AssetManifest | null {
  const path = join(distDir, '.kickjs-assets.json')
  if (!existsSync(path)) return null
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('node:fs')
    const raw = fs.readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<AssetManifest>
    if (parsed.version !== ASSET_MANIFEST_VERSION) return null
    if (!parsed.entries || typeof parsed.entries !== 'object') return null
    return parsed as AssetManifest
  } catch {
    return null
  }
}

/**
 * Project-root escape check that's safe across symlinks + drive letters.
 * `path.relative` returns `..` segments when the target sits above root,
 * and an absolute path when the two live on different roots (Windows).
 * `startsWith(root)` would miss both cases.
 */
function escapesRoot(path: string, root: string): boolean {
  const rel = relative(root, path)
  if (rel === '') return false
  return rel.startsWith('..') || isAbsolute(rel)
}

/** Pure helper — `false` for missing, non-dir, or unreadable paths. */
function isDirectorySync(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}
