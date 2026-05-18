// CLI Plugin shape.
//
// The kick CLI is itself a composition of plugins — every built-in
// command (init, generate, run, typegen, db, …) ships as a KickCliPlugin
// internally. Adopters extend the same surface from kick.config.ts to
// add commands, generators, and typegens; the merging + conflict
// detection runs the same way for built-ins and user plugins.
//
// Four contribution kinds:
//
//   • commands[]   — declarative shell-handler commands (same shape as
//                    the existing kick.config.ts `commands` field).
//   • register()   — programmatic commander registration. Called with
//                    `(program, ctx)` so the callback has cwd + config
//                    without re-loading.
//   • typegens[]   — TypegenPlugin instances that `kick typegen` runs
//                    after the legacy pass.
//   • generators[] — `kick g <name>` scaffolders (defineGenerator).
//                    Replaces the `package.json > kickjs.generators`
//                    discovery; that path stays as a deprecated
//                    fallback for one minor version.
//
// Mirrors `definePlugin` / `defineAdapter` factory parity so adopters
// don't have to learn a new helper-naming convention.

import type { Command } from 'commander'

import type { TypegenPlugin } from '../typegen/plugin'
import type { KickCommandDefinition, KickConfig } from '../config'
import type { GeneratorSpec } from '../generator-extension/define'
import type { DiscoveredGenerator } from '../generator-extension/discover'

/**
 * Runtime context handed to `register()` — saves callbacks from
 * re-loading config or guessing cwd. Forward-compatible: future fields
 * land here without changing the callback signature.
 */
export interface KickCliPluginContext {
  cwd: string
  /** Resolved kick.config.ts (null if the project has none). */
  config: KickConfig | null
  log: (msg: string) => void
  /**
   * Plugin-shipped generators merged from built-ins + adopter
   * `kick.config.ts > plugins[]`. Populated by `mergeCliPlugins` and
   * threaded through so `register()` callbacks (notably
   * `kick/generate`) can register each plugin generator as a real
   * Commander subcommand — without that, plugin generators only fire
   * via the bare-action dispatch and are invisible to `kick g --help`.
   *
   * Optional so light test harnesses that call `plugin.register(program)`
   * directly (no merge step) stay unaffected.
   */
  generators?: DiscoveredGenerator[]
}

export interface KickCliPlugin {
  /** Stable identifier — used in error messages on conflict + de-dup. */
  name: string
  commands?: KickCommandDefinition[]
  /** Programmatic command registration. Called once at CLI startup. */
  register?: (program: Command, ctx: KickCliPluginContext) => void | Promise<void>
  typegens?: TypegenPlugin[]
  generators?: GeneratorSpec[]
}

/** Identity helper — exists for type inference + parity with definePlugin. */
export function defineCliPlugin(p: KickCliPlugin): KickCliPlugin {
  return p
}

export class KickPluginConflictError extends Error {
  constructor(kind: 'plugin' | 'command' | 'typegen' | 'generator', id: string, owners: string[]) {
    super(
      `Two plugins registered the same ${kind} '${id}': ${owners.join(', ')}. ` +
        `Plugins must use unique ${kind} names.`,
    )
    this.name = 'KickPluginConflictError'
  }
}
