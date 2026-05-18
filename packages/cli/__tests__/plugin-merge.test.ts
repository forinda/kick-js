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

  it('register() forwards the same program + ctx to every plugin', async () => {
    const seen: Array<{ p: Command; cwd: string }> = []
    const a = defineCliPlugin({
      name: 'a',
      register: (p, ctx) => {
        seen.push({ p, cwd: ctx.cwd })
      },
    })
    const r = mergeCliPlugins([a])
    const program = new Command()
    await r.register(program, { cwd: '/tmp/x', config: null, log: () => {} })
    expect(seen[0].p).toBe(program)
    expect(seen[0].cwd).toBe('/tmp/x')
  })

  it('throws on duplicate generator name across two plugins', () => {
    const spec = (name: string) => ({
      name,
      description: '',
      args: [],
      files: () => [],
    })
    const a = defineCliPlugin({ name: 'a', generators: [spec('command')] })
    const b = defineCliPlugin({ name: 'b', generators: [spec('command')] })
    expect(() => mergeCliPlugins([a, b])).toThrow(KickPluginConflictError)
  })

  it('exposes plugin generators in DiscoveredGenerator shape', () => {
    const spec = {
      name: 'command',
      description: 'Generate a CQRS command',
      args: [],
      files: () => [],
    }
    const p = defineCliPlugin({ name: 'cqrs-plugin', generators: [spec] })
    const r = mergeCliPlugins([p])
    expect(r.generators).toHaveLength(1)
    expect(r.generators[0].source).toBe('cqrs-plugin')
    expect(r.generators[0].spec).toBe(spec)
  })

  it('threads merged generators into the register ctx', async () => {
    const spec = {
      name: 'drizzle-typegen',
      description: 'Generate Drizzle types',
      args: [{ name: 'schema', required: true }],
      files: () => [],
    }
    const plugin = defineCliPlugin({ name: 'drizzle', generators: [spec] })
    let seen: unknown
    const consumer = defineCliPlugin({
      name: 'consumer',
      register: (_program, ctx) => {
        seen = ctx?.generators
      },
    })
    const r = mergeCliPlugins([plugin, consumer])
    await r.register(new Command())
    expect(Array.isArray(seen)).toBe(true)
    expect((seen as { spec: { name: string } }[]).map((g) => g.spec.name)).toEqual([
      'drizzle-typegen',
    ])
  })

  it('threads caller-supplied projectRoot into the register ctx', async () => {
    let seen: string | undefined
    const consumer = defineCliPlugin({
      name: 'consumer',
      register: (_program, ctx) => {
        seen = ctx?.projectRoot
      },
    })
    const r = mergeCliPlugins([consumer])
    await r.register(new Command(), {
      cwd: '/foo/bar',
      projectRoot: '/foo',
      config: null,
      log: () => {},
    })
    expect(seen).toBe('/foo')
  })

  it('defaults projectRoot from process.cwd() when no ctx is supplied', async () => {
    let seen: string | undefined
    const consumer = defineCliPlugin({
      name: 'consumer',
      register: (_program, ctx) => {
        seen = ctx?.projectRoot
      },
    })
    const r = mergeCliPlugins([consumer])
    await r.register(new Command())
    // findProjectRoot(process.cwd()) returns an absolute path. We can't
    // assert the exact value (it depends on where the test runs from),
    // but it must be a non-empty absolute path.
    expect(typeof seen).toBe('string')
    expect((seen ?? '').length).toBeGreaterThan(0)
  })
})

describe('plugin generators registered as Commander subcommands', () => {
  it('each plugin generator becomes a kick g <name> subcommand', async () => {
    const { registerGenerateCommand } = await import('../src/commands/generate')
    const spec = {
      name: 'drizzle-typegen',
      description: 'Generate Drizzle types',
      args: [{ name: 'schema', required: true }],
      flags: [{ name: 'output', description: 'Output path' }],
      files: () => [],
    }
    const program = new Command()
    registerGenerateCommand(program, {
      cwd: process.cwd(),
      config: null,
      log: () => {},
      generators: [{ source: 'test-plugin', spec }],
    })
    const gen = program.commands.find((c) => c.name() === 'generate')!
    const sub = gen.commands.find((c) => c.name() === 'drizzle-typegen')
    expect(sub).toBeDefined()
    // Description includes the source plugin in brackets so adopters
    // can tell at a glance which plugin shipped the generator.
    expect(sub!.description()).toContain('Generate Drizzle types')
    expect(sub!.description()).toContain('[test-plugin]')
    // First positional honors required-ness from spec.args[0].
    expect(sub!.usage()).toMatch(/<schema>/)
    // Flags declared on the spec show up as --flags.
    const outputFlag = sub!.options.find((o) => o.long === '--output')
    expect(outputFlag).toBeDefined()
  })

  it('does not register plugin subcommands when ctx.generators is omitted', async () => {
    const { registerGenerateCommand } = await import('../src/commands/generate')
    const program = new Command()
    registerGenerateCommand(program)
    const gen = program.commands.find((c) => c.name() === 'generate')!
    // Built-in subcommands still register (module, controller, etc.).
    expect(gen.commands.length).toBeGreaterThan(0)
    // But no plugin-shipped generator slipped in.
    expect(gen.commands.find((c) => c.name() === 'drizzle-typegen')).toBeUndefined()
  })
})
