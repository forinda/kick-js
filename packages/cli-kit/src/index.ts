/**
 * `@forinda/kickjs-cli-kit` — the shared CLI-plugin contract.
 *
 * Both `@forinda/kickjs-cli` and packages that want to ship CLI commands
 * (e.g. `@forinda/kickjs-db/cli`) implement these types. Keeping the
 * contract in a dependency-free package breaks the dependency cycle that
 * would form if a package depended on `@forinda/kickjs-cli` to get
 * `defineCliPlugin` while the CLI depended on that package.
 *
 * The contract deliberately keeps the deep cli types loose:
 * - `ctx.config` is generic (`TConfig`, default `unknown`) — the host CLI
 *   passes its full config; consumers narrow as needed.
 * - `typegens` use {@link CliTypegen}, the structural shape the CLI's
 *   `TypegenPlugin` satisfies, so the kit never imports the typegen
 *   scanner.
 *
 * @module @forinda/kickjs-cli-kit
 */

import type { Command } from 'commander'

export * from './generators'
import type { GeneratorSpec } from './generators'

/**
 * A declarative shell-handler command — the same shape as the
 * `kick.config.ts > commands` field.
 */
export interface KickCommandDefinition {
  /** The command name (e.g. 'db:migrate', 'seed', 'proto:gen'). */
  name: string
  /** Description shown in --help. */
  description: string
  /**
   * Shell command(s) to run. A single string or an array of sequential
   * steps. Use `{args}` as a placeholder for forwarded CLI arguments.
   */
  steps: string | string[]
  /** Optional aliases (e.g. ['migrate'] for 'db:migrate'). */
  aliases?: string[]
}

/**
 * Structural shape of a typegen plugin as seen by the CLI-plugin
 * contract. The CLI's full `TypegenPlugin` satisfies this (the `ctx`
 * parameter is intentionally `any` here so the kit doesn't depend on the
 * CLI's `TypegenContext` / scanner types).
 */
export interface CliTypegen {
  id: string
  inputs: string[]
  outExtension?: string
  // `ctx` is `any` so the kit doesn't depend on the CLI's TypegenContext;
  // the return matches the CLI's TypegenPlugin exactly so the two are
  // mutually assignable.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  generate(ctx: any): Promise<string | null>
}

/** A plugin generator paired with the plugin name that supplied it. */
export interface DiscoveredGenerator {
  source: string
  spec: GeneratorSpec
}

/**
 * Runtime context handed to a plugin's `register()`. Forward-compatible:
 * new fields land here without changing the callback signature.
 */
export interface KickCliPluginContext<TConfig = unknown> {
  /** Directory the CLI was invoked from (may be a nested subdirectory). */
  cwd: string
  /**
   * Resolved project root — the nearest ancestor with a
   * `kick.config.{ts,js,mjs,json}` (or `package.json`). Prefer this over
   * `cwd` for writing artifacts at a stable location.
   */
  projectRoot: string
  /** The loaded host config (the CLI passes its full config). */
  config: TConfig | null
  log: (msg: string) => void
  /** Plugin-shipped generators merged by the host, threaded for register(). */
  generators?: DiscoveredGenerator[]
}

/**
 * A CLI plugin: contributes commands, programmatic command registration,
 * typegens, and/or generators. Implemented by the CLI's built-ins and by
 * adopter / first-party packages alike.
 */
export interface KickCliPlugin<TConfig = unknown> {
  /** Stable identifier — used in conflict errors + de-dup. */
  name: string
  /** Declarative shell-handler commands. */
  commands?: KickCommandDefinition[]
  /** Programmatic command registration, called once at CLI startup. */
  register?: (program: Command, ctx: KickCliPluginContext<TConfig>) => void | Promise<void>
  /** Typegen plugins the host runs after its own pass. */
  typegens?: CliTypegen[]
  /** `kick g <name>` scaffolders. */
  generators?: GeneratorSpec[]
}

/**
 * Identity helper for type inference + parity with `definePlugin` /
 * `defineAdapter`. Returns the plugin verbatim.
 */
export function defineCliPlugin<TConfig = unknown>(
  p: KickCliPlugin<TConfig>,
): KickCliPlugin<TConfig> {
  return p
}

/** Thrown when two plugins register the same plugin/command/typegen/generator id. */
export class KickPluginConflictError extends Error {
  constructor(kind: 'plugin' | 'command' | 'typegen' | 'generator', id: string, owners: string[]) {
    super(
      `Two plugins registered the same ${kind} '${id}': ${owners.join(', ')}. ` +
        `Plugins must use unique ${kind} names.`,
    )
    this.name = 'KickPluginConflictError'
  }
}
