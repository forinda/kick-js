import { writeFileSafe } from '../utils/fs'
import { buildGeneratorContext, resolveGeneratorPath } from './context'
import {
  discoverPluginGenerators,
  type DiscoveredGenerator,
  type DiscoveryResult,
} from './discover'
import type { GeneratorSpec } from './define'

export interface DispatchInput {
  /** The generator name typed on the CLI (`kick g command Order` → `'command'`). */
  generatorName: string
  /** The first positional argument after the generator name. */
  itemName: string
  /** Remaining positional arguments. */
  args?: string[]
  /** Parsed flag map (booleans + values). */
  flags?: Record<string, string | boolean>
  /** Project context — usually `process.cwd()`. */
  cwd?: string
  /**
   * Resolved project root. When omitted, `buildGeneratorContext` derives
   * it from `cwd` via `findProjectRoot()`. Pass through when the caller
   * has already resolved it (the CLI entry point does this once at
   * startup) to avoid re-walking the filesystem on every generator call.
   */
  projectRoot?: string
  /** Modules dir from `kick.config.ts`. */
  modulesDir?: string
  /** Whether the project enables auto-pluralization. */
  pluralize?: boolean
}

export interface DispatchResult {
  /** Absolute paths of the files that were written. */
  files: string[]
  /** Which plugin owns the generator we ran. */
  source: string
}

/**
 * Look up a plugin generator by name and run it. Returns `null` when
 * no plugin generator matches — callers can then fall through to the
 * built-in dispatch (module / scaffold / etc.).
 *
 * Resolution order:
 *   1. `additional` — generators sourced from `KickCliPlugin.generators`
 *      via `kick.config.ts > plugins[]`. Authoritative; the canonical
 *      path going forward.
 *   2. `package.json > kickjs.generators` discovery — first-match-wins
 *      in dependency declaration order. Deprecated path retained for
 *      packages that haven't migrated yet.
 *
 * Adopters with conflicts should rename the generator on their side or
 * pin one of the plugins to a different version.
 */
export async function tryDispatchPluginGenerator(
  input: DispatchInput,
  additional: readonly DiscoveredGenerator[] = [],
): Promise<DispatchResult | null> {
  const cwd = input.cwd ?? process.cwd()

  const fromConfig = additional.find((g) => g.spec.name === input.generatorName)
  if (fromConfig) {
    return runGenerator(fromConfig.spec, fromConfig.source, input, cwd)
  }

  const discovery = await discoverPluginGenerators(cwd)
  const match = findGenerator(discovery, input.generatorName)
  if (!match) return null

  return runGenerator(match.spec, match.source, input, cwd)
}

/**
 * Public helper for `kick g --list` — returns every plugin generator
 * the CLI knows about, merging config-supplied entries on top of the
 * package.json discovery result. Config entries always come first.
 */
export async function listPluginGenerators(
  cwd: string,
  additional: readonly DiscoveredGenerator[] = [],
): Promise<DiscoveryResult> {
  const discovered = await discoverPluginGenerators(cwd)
  const configNames = new Set(additional.map((g) => g.spec.name))
  const filteredDiscovered = discovered.generators.filter((g) => !configNames.has(g.spec.name))
  return {
    generators: [...additional, ...filteredDiscovered],
    loaded: discovered.loaded,
    failed: discovered.failed,
  }
}

function findGenerator(discovery: DiscoveryResult, name: string): DiscoveredGenerator | undefined {
  return discovery.generators.find((g) => g.spec.name === name)
}

/**
 * Invoke a {@link GeneratorSpec.files} factory with a fully-populated
 * {@link GeneratorContext}, write every returned file under the context's
 * cwd, and return the absolute paths along with the source plugin name.
 *
 * Threads `input.projectRoot` through to `buildGeneratorContext` so
 * callers that already resolved the project root (the CLI entry does
 * this once at startup) avoid a redundant filesystem walk. When omitted,
 * `buildGeneratorContext` derives `projectRoot` from `cwd` via
 * `findProjectRoot()` — keeping ad-hoc callers zero-config.
 */
async function runGenerator(
  spec: GeneratorSpec,
  source: string,
  input: DispatchInput,
  cwd: string,
): Promise<DispatchResult> {
  const ctx = buildGeneratorContext({
    name: input.itemName,
    args: input.args,
    flags: input.flags,
    modulesDir: input.modulesDir,
    pluralize: input.pluralize,
    cwd,
    projectRoot: input.projectRoot,
  })

  const files = await spec.files(ctx)
  const written: string[] = []

  for (const file of files) {
    const absPath = resolveGeneratorPath(ctx, file.path)
    await writeFileSafe(absPath, file.content)
    written.push(absPath)
  }

  return { files: written, source }
}
