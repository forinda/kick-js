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
import type { GeneratorSpec } from '../generator-extension/define'
import type { DiscoveredGenerator } from '../generator-extension/discover'
import { KickPluginConflictError, type KickCliPlugin, type KickCliPluginContext } from './types'

export interface MergedPlugins {
  commands: KickCommandDefinition[]
  typegens: TypegenPlugin[]
  /** DiscoveredGenerator shape so this list slots into the existing
   * dispatch path next to package.json-discovered entries. `source`
   * carries the plugin name for error attribution. */
  generators: DiscoveredGenerator[]
  /**
   * Apply every plugin's register() in input order. ctx is optional so
   * tests + lightweight callers can invoke `register(program)` without
   * constructing a full context; it falls back to cwd=process.cwd(),
   * config=null, log=no-op.
   */
  register: (program: Command, ctx?: KickCliPluginContext) => Promise<void>
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

  const generatorOwners = new Map<string, string>()
  const generators: DiscoveredGenerator[] = []
  for (const p of plugins) {
    for (const spec of p.generators ?? []) {
      const prior = generatorOwners.get(spec.name)
      if (prior) {
        throw new KickPluginConflictError('generator', spec.name, [prior, p.name])
      }
      generatorOwners.set(spec.name, p.name)
      generators.push({ source: p.name, spec: spec satisfies GeneratorSpec })
    }
  }

  /**
   * Apply every plugin's `register()` callback in input order against the
   * given Commander program. Each callback receives a {@link KickCliPluginContext}:
   * caller-supplied ctx wins (test fixtures can inject a different
   * workspace boundary); otherwise a default ctx is built with
   * `findProjectRoot(process.cwd())` as the project root, `cwd` matching
   * `process.cwd()`, null config, no-op log, and the merged generator set
   * threaded through so the `kick/generate` built-in can surface each as
   * a Commander subcommand. The dynamic import of `findProjectRoot` keeps
   * the caller-supplied fast path zero-cost.
   */
  const register = async (program: Command, ctx?: KickCliPluginContext): Promise<void> => {
    let resolved: KickCliPluginContext
    if (ctx) {
      resolved = { generators, ...ctx }
    } else {
      const { findProjectRoot } = await import('../utils/project-root')
      const cwd = process.cwd()
      resolved = {
        cwd,
        projectRoot: findProjectRoot(cwd),
        config: null,
        log: () => {},
        generators,
      }
    }
    for (const p of plugins) {
      if (p.register) await p.register(program, resolved)
    }
  }

  return { commands, typegens, generators, register }
}
