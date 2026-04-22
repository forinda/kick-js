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
 * The lookup is FIRST-MATCH-WINS in dependency declaration order: if
 * two plugins claim the same generator name, the one whose package was
 * resolved first wins. Adopters with conflicts should rename the
 * generator on their side or pin one of the plugins to a different
 * version.
 */
export async function tryDispatchPluginGenerator(
  input: DispatchInput,
): Promise<DispatchResult | null> {
  const cwd = input.cwd ?? process.cwd()
  const discovery = await discoverPluginGenerators(cwd)
  const match = findGenerator(discovery, input.generatorName)
  if (!match) return null

  return runGenerator(match.spec, match.source, input, cwd)
}

/** Public helper for `kick g --list` — returns every discovered plugin generator. */
export async function listPluginGenerators(cwd: string): Promise<DiscoveryResult> {
  return discoverPluginGenerators(cwd)
}

function findGenerator(discovery: DiscoveryResult, name: string): DiscoveredGenerator | undefined {
  return discovery.generators.find((g) => g.spec.name === name)
}

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
