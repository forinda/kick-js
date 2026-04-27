import { describe, it, expect } from 'vitest'
import { Command } from 'commander'

import { defineCliPlugin, mergeCliPlugins, KickPluginConflictError } from '../src/plugin'

const cmd = (name: string) => ({ name, description: '', steps: 'echo h' })
const tg = (id: string) => ({
  id,
  inputs: [] as string[],
  async generate() {
    return ''
  },
})

describe('mergeCliPlugins', () => {
  it('appends plugin commands then adopter commands', () => {
    const a = defineCliPlugin({ name: 'a', commands: [cmd('one')] })
    const b = defineCliPlugin({ name: 'b', commands: [cmd('two')] })
    const r = mergeCliPlugins([a, b], [cmd('local')])
    expect(r.commands.map((c) => c.name)).toEqual(['one', 'two', 'local'])
  })

  it('adopter command overrides plugin command of the same name', () => {
    const a = defineCliPlugin({ name: 'a', commands: [cmd('shared')] })
    const r = mergeCliPlugins([a], [cmd('shared')])
    expect(r.commands).toHaveLength(1)
    expect(r.commands[0]).toEqual(cmd('shared'))
  })

  it('throws on duplicate command across two plugins', () => {
    const a = defineCliPlugin({ name: 'a', commands: [cmd('x')] })
    const b = defineCliPlugin({ name: 'b', commands: [cmd('x')] })
    expect(() => mergeCliPlugins([a, b])).toThrow(KickPluginConflictError)
  })

  it('throws on duplicate typegen across two plugins', () => {
    const a = defineCliPlugin({ name: 'a', typegens: [tg('kick/db')] })
    const b = defineCliPlugin({ name: 'b', typegens: [tg('kick/db')] })
    expect(() => mergeCliPlugins([a, b])).toThrow(KickPluginConflictError)
  })

  it('preserves typegen order across plugins', () => {
    const a = defineCliPlugin({ name: 'a', typegens: [tg('one')] })
    const b = defineCliPlugin({ name: 'b', typegens: [tg('two'), tg('three')] })
    const r = mergeCliPlugins([a, b])
    expect(r.typegens.map((t) => t.id)).toEqual(['one', 'two', 'three'])
  })

  it('throws on duplicate plugin name (catches double-install)', () => {
    const a = defineCliPlugin({ name: 'shared' })
    const b = defineCliPlugin({ name: 'shared' })
    expect(() => mergeCliPlugins([a, b])).toThrow(KickPluginConflictError)
  })

  it('register() invokes every plugin register in input order', async () => {
    const calls: string[] = []
    const a = defineCliPlugin({
      name: 'a',
      register: () => {
        calls.push('a')
      },
    })
    const b = defineCliPlugin({
      name: 'b',
      register: async () => {
        calls.push('b')
      },
    })
    const r = mergeCliPlugins([a, b])
    const program = new Command()
    await r.register(program)
    expect(calls).toEqual(['a', 'b'])
  })

  it('register() forwards the same program to every plugin', async () => {
    const seen: Command[] = []
    const a = defineCliPlugin({
      name: 'a',
      register: (p) => {
        seen.push(p)
      },
    })
    const r = mergeCliPlugins([a])
    const program = new Command()
    await r.register(program)
    expect(seen[0]).toBe(program)
  })
})
