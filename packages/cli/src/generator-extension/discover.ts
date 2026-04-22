import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { GeneratorSpec } from './define'
import { importManifest } from './context'

/**
 * One row in the discovered registry. `source` is the npm package name
 * the generator came from — surfaced in error messages so adopters can
 * see which plugin owns a given generator.
 */
export interface DiscoveredGenerator {
  source: string
  spec: GeneratorSpec
}

/**
 * Plugin discovery result, kept around even when no generators were
 * registered so callers can distinguish "no plugins installed" from
 * "no plugins matched the requested name."
 */
export interface DiscoveryResult {
  generators: DiscoveredGenerator[]
  /** Packages whose `kickjs.generators` was loaded successfully. */
  loaded: string[]
  /**
   * Packages we tried to load but failed — typically a missing entry
   * file or a default export that wasn't an array of GeneratorSpec.
   */
  failed: Array<{ source: string; reason: string }>
}

/** Shape of `package.json` we care about during discovery. */
interface PluginPackage {
  name?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  kickjs?: {
    generators?: string
  }
  keywords?: string[]
}

/**
 * Discover generator manifests shipped by every kickjs plugin in the
 * project's direct deps. Spec rationale: walking the
 * `node_modules/@scope/kickjs-name/` tree is one option, but reading
 * the project's own `package.json` and resolving each dep through
 * Node's module resolver gives:
 *
 *   1. Predictable scoping — only deps the project actually declared
 *      get scanned, no surprises from transitive packages
 *   2. pnpm `.pnpm` store compatibility — `createRequire().resolve()`
 *      handles the symlinked layout correctly
 *   3. Clear error attribution — the source package name is always
 *      known before the import happens
 *
 * The walk is shallow (direct deps only). Transitive plugins that want
 * to expose generators must be re-exported by a direct dep.
 *
 * Caches per-cwd inside one CLI invocation so a single `kick g` call
 * does the disk + import work exactly once even when multiple
 * generators dispatch through the same registry.
 */
const cache = new Map<string, Promise<DiscoveryResult>>()

export async function discoverPluginGenerators(cwd: string): Promise<DiscoveryResult> {
  const cached = cache.get(cwd)
  if (cached) return cached
  const promise = doDiscover(cwd)
  cache.set(cwd, promise)
  return promise
}

/** Reset the cache — used by tests so repeated runs see fresh fixtures. */
export function resetGeneratorDiscoveryCache(): void {
  cache.clear()
}

async function doDiscover(cwd: string): Promise<DiscoveryResult> {
  const projectPkgPath = resolve(cwd, 'package.json')
  if (!existsSync(projectPkgPath)) {
    return { generators: [], loaded: [], failed: [] }
  }

  const projectPkg = JSON.parse(await readFile(projectPkgPath, 'utf-8')) as PluginPackage
  const depNames = collectDepNames(projectPkg)

  const require = createRequire(resolve(cwd, 'package.json'))

  const generators: DiscoveredGenerator[] = []
  const loaded: string[] = []
  const failed: Array<{ source: string; reason: string }> = []

  for (const depName of depNames) {
    let depPkgPath: string
    try {
      depPkgPath = require.resolve(`${depName}/package.json`)
    } catch {
      // Dep declared but not installed (or doesn't expose package.json
      // via its export map). Skip silently — this is `kick g`, not
      // `pnpm install`.
      continue
    }

    let depPkg: PluginPackage
    try {
      depPkg = JSON.parse(await readFile(depPkgPath, 'utf-8')) as PluginPackage
    } catch (err) {
      failed.push({ source: depName, reason: `failed to parse package.json: ${err}` })
      continue
    }

    if (!depPkg.kickjs?.generators) continue

    const entryRel = depPkg.kickjs.generators
    const entryAbs = resolve(dirname(depPkgPath), entryRel)
    if (!existsSync(entryAbs)) {
      failed.push({
        source: depName,
        reason: `kickjs.generators points to missing file: ${entryRel}`,
      })
      continue
    }

    let mod: unknown
    try {
      mod = await importManifest(entryAbs)
    } catch (err) {
      failed.push({ source: depName, reason: `failed to import manifest: ${err}` })
      continue
    }

    const manifest = (mod as { default?: unknown }).default
    if (!Array.isArray(manifest)) {
      failed.push({
        source: depName,
        reason: `manifest's default export is not an array of GeneratorSpec`,
      })
      continue
    }

    for (const entry of manifest) {
      if (!isGeneratorSpec(entry)) {
        failed.push({
          source: depName,
          reason: `manifest entry is not a valid GeneratorSpec (missing name/files)`,
        })
        continue
      }
      generators.push({ source: depName, spec: entry })
    }
    loaded.push(depName)
  }

  return { generators, loaded, failed }
}

function collectDepNames(pkg: PluginPackage): string[] {
  const set = new Set<string>()
  for (const block of [pkg.dependencies, pkg.devDependencies, pkg.peerDependencies]) {
    if (!block) continue
    for (const name of Object.keys(block)) set.add(name)
  }
  return Array.from(set)
}

function isGeneratorSpec(entry: unknown): entry is GeneratorSpec {
  if (!entry || typeof entry !== 'object') return false
  const e = entry as Record<string, unknown>
  return typeof e.name === 'string' && typeof e.files === 'function'
}
