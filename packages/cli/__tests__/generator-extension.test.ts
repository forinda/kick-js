import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  defineGenerator,
  buildGeneratorContext,
  discoverPluginGenerators,
  resetGeneratorDiscoveryCache,
  tryDispatchPluginGenerator,
  listPluginGenerators,
  type GeneratorContext,
} from '../src/generator-extension'

let fixture: string

/**
 * Build a synthetic project layout with one or more `kickjs.generators`
 * plugins inside `node_modules`. Each plugin gets a tiny `package.json`
 * + a manifest entry file the discovery loader will dynamic-import.
 */
function createPluginFixture(plugins: Array<{ name: string; manifest: string }>): string {
  const dir = mkdtempSync(join(tmpdir(), 'kick-gen-ext-'))

  // Project package.json declares each plugin as a dep so the discovery
  // shallow-walk picks them up.
  const deps: Record<string, string> = {}
  for (const p of plugins) deps[p.name] = '*'
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'fixture', version: '0.0.0', dependencies: deps }, null, 2),
  )

  for (const { name, manifest } of plugins) {
    const pkgDir = join(dir, 'node_modules', name)
    mkdirSync(pkgDir, { recursive: true })
    writeFileSync(
      join(pkgDir, 'package.json'),
      JSON.stringify(
        {
          name,
          version: '0.0.0',
          kickjs: { generators: './generators.mjs' },
        },
        null,
        2,
      ),
    )
    writeFileSync(join(pkgDir, 'generators.mjs'), manifest)
  }

  return dir
}

beforeEach(() => {
  resetGeneratorDiscoveryCache()
})

afterEach(() => {
  if (fixture) rmSync(fixture, { recursive: true, force: true })
})

describe('defineGenerator', () => {
  it('returns the spec verbatim (identity factory)', () => {
    const spec = defineGenerator({
      name: 'command',
      description: 'Generate a CQRS command',
      files: () => [],
    })
    expect(spec.name).toBe('command')
    expect(spec.description).toBe('Generate a CQRS command')
    expect(typeof spec.files).toBe('function')
  })
})

describe('buildGeneratorContext', () => {
  it('emits PascalCase / camelCase / kebab / snake variants', () => {
    const ctx = buildGeneratorContext({ name: 'UserPost' })
    expect(ctx.pascal).toBe('UserPost')
    expect(ctx.camel).toBe('userPost')
    expect(ctx.kebab).toBe('user-post')
    expect(ctx.snake).toBe('user_post')
  })

  it('emits plural variants when pluralize is enabled (default)', () => {
    const ctx = buildGeneratorContext({ name: 'task' })
    expect(ctx.pluralKebab).toBe('tasks')
    expect(ctx.pluralPascal).toBe('Tasks')
    expect(ctx.pluralCamel).toBe('tasks')
  })

  it('omits plural variants when pluralize is disabled', () => {
    const ctx = buildGeneratorContext({ name: 'task', pluralize: false })
    expect(ctx.pluralKebab).toBeUndefined()
    expect(ctx.pluralPascal).toBeUndefined()
    expect(ctx.pluralCamel).toBeUndefined()
  })

  it('handles snake_case + kebab-case + Pascal input the same way', () => {
    const fromSnake = buildGeneratorContext({ name: 'user_post' })
    const fromKebab = buildGeneratorContext({ name: 'user-post' })
    const fromPascal = buildGeneratorContext({ name: 'UserPost' })
    expect(fromSnake.pascal).toBe(fromPascal.pascal)
    expect(fromKebab.pascal).toBe(fromPascal.pascal)
  })
})

describe('discoverPluginGenerators', () => {
  it('returns empty result when no project package.json exists', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'kick-gen-empty-'))
    fixture = empty
    const result = await discoverPluginGenerators(empty)
    expect(result.generators).toEqual([])
    expect(result.loaded).toEqual([])
    expect(result.failed).toEqual([])
  })

  it('skips deps that have no kickjs.generators field', async () => {
    fixture = createPluginFixture([])
    const result = await discoverPluginGenerators(fixture)
    expect(result.generators).toEqual([])
  })

  it('loads generators declared via kickjs.generators', async () => {
    fixture = createPluginFixture([
      {
        name: '@my-org/kickjs-cqrs',
        manifest: `
          export default [
            { name: 'command', description: 'CQRS command', files: () => [] },
            { name: 'query',   description: 'CQRS query',   files: () => [] },
          ]
        `,
      },
    ])

    const result = await discoverPluginGenerators(fixture)
    expect(result.loaded).toEqual(['@my-org/kickjs-cqrs'])
    expect(result.generators.map((g) => g.spec.name).sort()).toEqual(['command', 'query'])
    for (const g of result.generators) expect(g.source).toBe('@my-org/kickjs-cqrs')
  })

  it('reports manifests whose default export is not an array', async () => {
    fixture = createPluginFixture([
      {
        name: '@my-org/kickjs-bad',
        manifest: `export default { name: 'oops' }`,
      },
    ])
    const result = await discoverPluginGenerators(fixture)
    expect(result.generators).toEqual([])
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0].source).toBe('@my-org/kickjs-bad')
    expect(result.failed[0].reason).toMatch(/not an array/)
  })

  it('reports manifest entries missing the required fields', async () => {
    fixture = createPluginFixture([
      {
        name: '@my-org/kickjs-bad',
        manifest: `export default [{ description: 'no name + no files' }]`,
      },
    ])
    const result = await discoverPluginGenerators(fixture)
    expect(result.generators).toEqual([])
    expect(result.failed[0].reason).toMatch(/not a valid GeneratorSpec/)
  })

  it('reports a missing entry file as a failed plugin', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kick-gen-missing-'))
    fixture = dir
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        dependencies: { '@my-org/kickjs-broken': '*' },
      }),
    )
    const pkgDir = join(dir, 'node_modules', '@my-org/kickjs-broken')
    mkdirSync(pkgDir, { recursive: true })
    writeFileSync(
      join(pkgDir, 'package.json'),
      JSON.stringify({
        name: '@my-org/kickjs-broken',
        kickjs: { generators: './does-not-exist.mjs' },
      }),
    )
    const result = await discoverPluginGenerators(dir)
    expect(result.failed[0].reason).toMatch(/missing file/)
  })

  it('caches per-cwd within a single process — two calls hit one disk pass', async () => {
    fixture = createPluginFixture([
      {
        name: '@my-org/kickjs-cqrs',
        manifest: `export default [{ name: 'command', description: 'x', files: () => [] }]`,
      },
    ])
    const a = await discoverPluginGenerators(fixture)
    const b = await discoverPluginGenerators(fixture)
    // Same array reference proves the cache returned the same Promise
    expect(a).toBe(b)
  })
})

describe('tryDispatchPluginGenerator', () => {
  it('returns null when no plugin claims the generator name', async () => {
    fixture = createPluginFixture([])
    const result = await tryDispatchPluginGenerator({
      generatorName: 'command',
      itemName: 'CreateOrder',
      cwd: fixture,
    })
    expect(result).toBeNull()
  })

  it('writes the files returned by the matched generator', async () => {
    fixture = createPluginFixture([
      {
        name: '@my-org/kickjs-cqrs',
        manifest: `
          export default [
            {
              name: 'command',
              description: 'CQRS command',
              files: (ctx) => [
                {
                  path: 'generated/' + ctx.kebab + '.command.ts',
                  content: '// command for ' + ctx.pascal,
                },
              ],
            },
          ]
        `,
      },
    ])

    const result = await tryDispatchPluginGenerator({
      generatorName: 'command',
      itemName: 'CreateOrder',
      cwd: fixture,
    })

    expect(result).not.toBeNull()
    expect(result!.source).toBe('@my-org/kickjs-cqrs')
    expect(result!.files).toHaveLength(1)
    expect(result!.files[0]).toMatch(/generated\/create-order\.command\.ts$/)
  })

  it('first-match-wins when two plugins declare the same generator name', async () => {
    fixture = createPluginFixture([
      {
        name: '@first/kickjs-claim',
        manifest: `export default [{ name: 'command', description: 'first', files: () => [] }]`,
      },
      {
        name: '@second/kickjs-claim',
        manifest: `export default [{ name: 'command', description: 'second', files: () => [] }]`,
      },
    ])

    const result = await tryDispatchPluginGenerator({
      generatorName: 'command',
      itemName: 'X',
      cwd: fixture,
    })
    // dependencies key order in package.json is preserved in V8 — first
    // declared wins.
    expect(result!.source).toBe('@first/kickjs-claim')
  })

  it('forwards extra positional args + flags into ctx', async () => {
    fixture = createPluginFixture([
      {
        name: '@my-org/kickjs-cqrs',
        manifest: `
          export default [
            {
              name: 'command',
              description: 'CQRS command',
              files: (ctx) => [
                {
                  path: 'log.json',
                  content: JSON.stringify({ args: ctx.args, flags: ctx.flags }),
                },
              ],
            },
          ]
        `,
      },
    ])

    const result = await tryDispatchPluginGenerator({
      generatorName: 'command',
      itemName: 'CreateOrder',
      args: ['extra1', 'extra2'],
      flags: { dry: true, target: 'src' },
      cwd: fixture,
    })

    expect(result).not.toBeNull()
    // Read the file we just wrote and assert ctx propagation
    const fs = await import('node:fs/promises')
    const written = await fs.readFile(result!.files[0], 'utf-8')
    const parsed = JSON.parse(written) as { args: string[]; flags: Record<string, unknown> }
    expect(parsed.args).toEqual(['extra1', 'extra2'])
    expect(parsed.flags).toMatchObject({ dry: true, target: 'src' })
  })
})

describe('listPluginGenerators', () => {
  it('exposes the same DiscoveryResult as the dispatcher uses', async () => {
    fixture = createPluginFixture([
      {
        name: '@my-org/kickjs-cqrs',
        manifest: `export default [{ name: 'command', description: 'x', files: () => [] }]`,
      },
    ])
    const result = await listPluginGenerators(fixture)
    expect(result.loaded).toContain('@my-org/kickjs-cqrs')
    expect(result.generators[0].spec.name).toBe('command')
  })
})

describe('GeneratorContext typing', () => {
  it('build returns the typed shape declared in GeneratorContext', () => {
    const ctx: GeneratorContext = buildGeneratorContext({ name: 'task' })
    expect(ctx.cwd).toBe(process.cwd())
    expect(ctx.modulesDir).toBe('src/modules')
    expect(ctx.args).toEqual([])
    expect(ctx.flags).toEqual({})
  })
})
