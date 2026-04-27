// CLI Plugin shape (v1).
//
// The kick CLI is itself a composition of plugins — every built-in
// command (init, generate, run, typegen, db, …) ships as a KickCliPlugin
// internally. Adopters extend the same surface from kick.config.ts to
// add commands and typegens; the merging + conflict detection runs the
// same way for built-ins and user plugins.
//
// Three contribution kinds:
//
//   • commands[]  — declarative shell-handler commands (same shape as
//                   the existing kick.config.ts `commands` field).
//   • register()  — programmatic commander registration (the only way
//                   to express built-ins like `kick generate <pattern>
//                   <name>` whose chain has options, subcommands, etc.).
//   • typegens[]  — TypegenPlugin instances that the `kick typegen`
//                   command runs after the legacy pass.
//
// Mirrors `definePlugin` / `defineAdapter` factory parity so adopters
// don't have to learn a new helper-naming convention.

import type { Command } from 'commander'

import type { TypegenPlugin } from '../typegen/plugin'
import type { KickCommandDefinition } from '../config'

export interface KickCliPlugin {
  /** Stable identifier — used in error messages on conflict + de-dup. */
  name: string
  commands?: KickCommandDefinition[]
  /** Programmatic command registration. Called once at CLI startup. */
  register?: (program: Command) => void | Promise<void>
  typegens?: TypegenPlugin[]
}

/** Identity helper — exists for type inference + parity with definePlugin. */
export function defineCliPlugin(p: KickCliPlugin): KickCliPlugin {
  return p
}

export class KickPluginConflictError extends Error {
  constructor(kind: 'plugin' | 'command' | 'typegen', id: string, owners: string[]) {
    super(
      `Two plugins registered the same ${kind} '${id}': ${owners.join(', ')}. ` +
        `Plugins must use unique ${kind} names.`,
    )
    this.name = 'KickPluginConflictError'
  }
}
