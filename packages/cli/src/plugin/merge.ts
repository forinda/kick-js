// Plugin → unified registry merge.
//
// Resolution rules (per the v1 spec + dogfood pivot):
//   - duplicate plugin `name` across the input array → conflict error.
//     Catches the double-install case (built-in shipped twice, or
//     adopter requiring the same plugin twice).
//   - plugin commands appear first in the merged list, then adopter
//     commands; adopter `commands` of the same name override the
//     plugin entry (filter pass).
//   - duplicate command name across two plugins → conflict error
//     listing both plugin names. Adopter overriding a plugin is
//     allowed and not an error.
//   - duplicate typegen id across two plugins → same error. Typegens
//     have no adopter override path; only plugins contribute them.
//   - register() functions are collected in input order; the caller
//     invokes each one against the same Command program. They have no
//     id-level conflict surface — owners are responsible for picking
//     non-colliding command names inside their own register().
//   - plugin order = array order. No implicit precedence rules.

import type { Command } from 'commander'

import type { KickCommandDefinition } from '../config'
import type { TypegenPlugin } from '../typegen/plugin'
import { KickPluginConflictError, type KickCliPlugin } from './types'

export interface MergedPlugins {
  commands: KickCommandDefinition[]
  typegens: TypegenPlugin[]
  /** Apply every plugin's register() in input order. */
  register: (program: Command) => Promise<void>
}

export function mergeCliPlugins(
  plugins: readonly KickCliPlugin[],
  adopterCommands: readonly KickCommandDefinition[] = [],
): MergedPlugins {
  // Plugin-name dedup — catches double-install.
  const seenPluginNames = new Map<string, number>()
  for (const p of plugins) {
    const count = (seenPluginNames.get(p.name) ?? 0) + 1
    seenPluginNames.set(p.name, count)
    if (count === 2) {
      throw new KickPluginConflictError('plugin', p.name, [p.name, p.name])
    }
  }

  const commandOwners = new Map<string, string>()
  const pluginCommands: KickCommandDefinition[] = []
  for (const p of plugins) {
    for (const cmd of p.commands ?? []) {
      const prior = commandOwners.get(cmd.name)
      if (prior) {
        throw new KickPluginConflictError('command', cmd.name, [prior, p.name])
      }
      commandOwners.set(cmd.name, p.name)
      pluginCommands.push(cmd)
    }
  }

  const adopterNames = new Set(adopterCommands.map((c) => c.name))
  const filteredPlugin = pluginCommands.filter((c) => !adopterNames.has(c.name))
  const commands = [...filteredPlugin, ...adopterCommands]

  const typegenOwners = new Map<string, string>()
  const typegens: TypegenPlugin[] = []
  for (const p of plugins) {
    for (const tg of p.typegens ?? []) {
      const prior = typegenOwners.get(tg.id)
      if (prior) {
        throw new KickPluginConflictError('typegen', tg.id, [prior, p.name])
      }
      typegenOwners.set(tg.id, p.name)
      typegens.push(tg)
    }
  }

  const register = async (program: Command): Promise<void> => {
    for (const p of plugins) {
      if (p.register) await p.register(program)
    }
  }

  return { commands, typegens, register }
}
