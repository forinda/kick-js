/**
 * `kick add` wiring helpers: which layers a package list brings, how their
 * files land in an existing project, and the uncommitted-changes guard.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  applyLayerFiles,
  dirtyFiles,
  findEntry,
  findEnvSchema,
  importsAny,
  planWiring,
  sourceFilesInTheWay,
  wireEntry,
  wireEnv,
} from '../src/commands/add-wire'

let dir: string
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})
const tmp = () => (dir = mkdtempSync(join(tmpdir(), 'kick-add-')))

describe('planWiring', () => {
  it('renders the layers of packages that have one, and nothing for the rest', () => {
    expect(planWiring(['pg', 'queue:kafka'])).toBeUndefined()
    const plan = planWiring(['devtools', 'queue', 'queue:bullmq', 'pg'])!
    expect(plan.dependencies).toEqual(
      expect.arrayContaining(['@forinda/kickjs-queue', 'bullmq', 'ioredis']),
    )
    // The entry imports devtools only under `kick dev`, so it stays a dev dependency.
    expect(plan.dependencies).not.toContain('@forinda/kickjs-devtools')
    expect(plan.devDependencies).toContain('@forinda/kickjs-devtools')
    expect(plan.integrations.flatMap((i) => i.import?.names ?? [])).toEqual(['queueAdapter'])
    expect(plan.files.get('src/devtools.d.ts')).toContain(
      '/// <reference types="@forinda/kickjs-vite/globals" />',
    )
    expect(plan.builds).toEqual({ 'msgpackr-extract': false })
  })
})

describe('applyLayerFiles', () => {
  it('adds only missing keys to an existing .env, and creates missing files', async () => {
    tmp()
    writeFileSync(join(dir, '.env'), 'PORT=3000\nREDIS_HOST=redis.internal')
    const changed = await applyLayerFiles(
      dir,
      new Map([
        ['.env', 'REDIS_HOST=127.0.0.1\nREDIS_PORT=6379\n'],
        ['.env.example', 'REDIS_HOST=127.0.0.1\n'],
      ]),
    )
    expect(changed).toEqual({ created: ['.env.example'], updated: ['.env'] })
    // The existing value is kept; only the missing key is added.
    expect(readFileSync(join(dir, '.env'), 'utf-8')).toBe(
      'PORT=3000\nREDIS_HOST=redis.internal\nREDIS_PORT=6379\n',
    )
    expect(readFileSync(join(dir, '.env.example'), 'utf-8')).toBe('REDIS_HOST=127.0.0.1\n')
    // Running again changes nothing.
    expect(
      await applyLayerFiles(dir, new Map([['.env', 'REDIS_HOST=127.0.0.1\nREDIS_PORT=6379\n']])),
    ).toEqual({ created: [], updated: [] })
  })
})

describe('dirtyFiles', () => {
  it('lists the given files with uncommitted changes, and nothing outside git', () => {
    tmp()
    writeFileSync(join(dir, 'a.ts'), 'a')
    expect(dirtyFiles(dir, ['a.ts'])).toEqual([])
    const git = (...args: string[]) =>
      execFileSync('git', args, {
        cwd: dir,
        stdio: 'ignore',
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 't',
          GIT_AUTHOR_EMAIL: 't@t',
          GIT_COMMITTER_NAME: 't',
          GIT_COMMITTER_EMAIL: 't@t',
        },
      })
    git('init', '-q')
    // A fresh scaffold, never committed: nothing to protect yet.
    expect(dirtyFiles(dir, ['a.ts'])).toEqual([])
    git('add', '-A')
    git('commit', '-qm', 'init')
    writeFileSync(join(dir, 'b.ts'), 'b')
    expect(dirtyFiles(dir, ['a.ts', 'b.ts'])).toEqual([])
    writeFileSync(join(dir, 'a.ts'), 'changed')
    expect(dirtyFiles(dir, ['a.ts', '.env'])).toEqual(['a.ts'])
    // Staged: kick add's edits still show as their own `git diff`.
    git('add', 'a.ts')
    expect(dirtyFiles(dir, ['a.ts'])).toEqual([])
  })

  it('ignores a project that is untracked inside a parent repository', () => {
    tmp()
    execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' })
    mkdirSync(join(dir, 'app/src'), { recursive: true })
    writeFileSync(join(dir, 'app/src/index.ts'), 'x')
    expect(dirtyFiles(join(dir, 'app'), ['src/index.ts'])).toEqual([])
  })
})

describe('wireEntry', () => {
  it('fills the project name and writes the wired entry', async () => {
    tmp()
    mkdirSync(join(dir, 'src'))
    writeFileSync(join(dir, 'package.json'), '{ "name": "shop", "version": "2.0.0" }')
    writeFileSync(join(dir, 'src/main.ts'), 'await bootstrap({\n  modules,\n})\n')
    expect(findEntry(dir)).toBe('src/main.ts')

    const result = await wireEntry(dir, 'src/main.ts', planWiring(['swagger'])!.integrations)
    expect(result.added).toEqual(['SwaggerAdapter'])
    expect(readFileSync(join(dir, 'src/main.ts'), 'utf-8')).toContain(
      "SwaggerAdapter({ info: { title: 'shop', version: '2.0.0' } })",
    )
    const entry = readFileSync(join(dir, 'src/main.ts'), 'utf-8')
    expect(entry).toContain("import { SwaggerAdapter } from '@forinda/kickjs-swagger'")
    expect(entry).toContain('adapters: [')
  })
})

describe('kick add storage', () => {
  it('writes src/adapters/storage.ts, the env and gitignore lines, and wires storageAdapter()', async () => {
    tmp()
    mkdirSync(join(dir, 'src'))
    writeFileSync(join(dir, '.gitignore'), 'node_modules\n')
    writeFileSync(
      join(dir, 'src/index.ts'),
      "import { bootstrap } from '@forinda/kickjs'\n\nawait bootstrap({\n  modules,\n  adapters: [],\n})\n",
    )
    const plan = planWiring(['storage'])!
    expect(plan.dependencies).toEqual(['@forinda/kickjs-storage'])
    const changed = await applyLayerFiles(dir, plan.files)
    // The file it just wrote is reported as created, not updated.
    expect(changed).toEqual({
      created: ['.env.example', 'src/adapters/storage.ts'],
      updated: ['.gitignore'],
    })
    expect(readFileSync(join(dir, '.gitignore'), 'utf-8')).toBe('node_modules\nuploads/\n.tus/\n')
    expect(readFileSync(join(dir, 'src/adapters/storage.ts'), 'utf-8')).toContain(
      'export const storageAdapter',
    )

    const result = await wireEntry(dir, 'src/index.ts', plan.integrations)
    expect(result.added).toEqual(['storageAdapter'])
    const entry = readFileSync(join(dir, 'src/index.ts'), 'utf-8')
    expect(entry).toContain("import { storageAdapter } from './adapters/storage'")
    expect(entry).toMatch(/adapters: \[[\s\S]*storageAdapter\(\)/)

    // Again: nothing new.
    expect(await applyLayerFiles(dir, plan.files)).toEqual({ created: [], updated: [] })
    expect((await wireEntry(dir, 'src/index.ts', plan.integrations)).present).toEqual([
      'storageAdapter',
    ])
  })
})

describe('kick add storage over an existing src/adapters/storage.ts', () => {
  it("keeps the app's file and doesn't wire what imports it", async () => {
    tmp()
    mkdirSync(join(dir, 'src/adapters'), { recursive: true })
    const mine = 'export const storageAdapter = () => myOwnThing()\n'
    writeFileSync(join(dir, 'src/adapters/storage.ts'), mine)
    writeFileSync(join(dir, 'src/index.ts'), 'await bootstrap({\n  modules,\n  adapters: [],\n})\n')
    const plan = planWiring(['storage'])!

    expect(sourceFilesInTheWay(dir, plan.files)).toEqual(['src/adapters/storage.ts'])
    await applyLayerFiles(dir, plan.files)
    // Not appended to: a second declaration wouldn't compile.
    expect(readFileSync(join(dir, 'src/adapters/storage.ts'), 'utf-8')).toBe(mine)
    // The env and gitignore lines still land.
    expect(readFileSync(join(dir, '.gitignore'), 'utf-8')).toContain('uploads/')

    const blocked = plan.integrations.filter((i) =>
      importsAny(i, 'src/index.ts', ['src/adapters/storage.ts']),
    )
    expect(blocked.map((i) => i.import?.names)).toEqual([['storageAdapter']])
    expect(importsAny(plan.integrations[0], 'src/main.ts', ['src/adapters/storage.ts'])).toBe(true)
    expect(importsAny(plan.integrations[0], 'src/app/index.ts', ['src/adapters/storage.ts'])).toBe(
      false,
    )
  })

  it('counts the file it generated itself as in place, not in the way', async () => {
    tmp()
    const plan = planWiring(['storage'])!
    await applyLayerFiles(dir, plan.files)
    expect(sourceFilesInTheWay(dir, plan.files)).toEqual([])
  })
})

describe('kick add queue', () => {
  const config = (lib: string, object: string) =>
    `import { loadEnvFromSchema } from '@forinda/kickjs/config'\nimport ${lib === 'zod' ? '{ z }' : lib === 'valibot' ? '* as v' : '* as yup'} from '${lib}'\n\nconst envSchema = x(\n  ${object}({\n    PORT: p,\n    // DATABASE_URL: d,\n  }),\n)\n\nloadEnvFromSchema(envSchema)\n`

  it('declares REDIS_* in the env schema and reads them with getEnv, not process.env', async () => {
    tmp()
    mkdirSync(join(dir, 'src/config'), { recursive: true })
    writeFileSync(join(dir, 'src/config/index.ts'), config('zod', 'z.object'))
    writeFileSync(join(dir, 'src/index.ts'), 'await bootstrap({\n  modules,\n})\n')
    const plan = planWiring(['queue'])!
    const { created } = await applyLayerFiles(dir, plan.files)
    expect(created).toContain('src/adapters/queue.ts')
    // No .env with values the schema already defaults.
    expect(created).not.toContain('.env')
    const adapter = readFileSync(join(dir, 'src/adapters/queue.ts'), 'utf-8')
    expect(adapter).toContain("host: getEnv('REDIS_HOST')")
    expect(adapter).not.toContain('process.env')

    const entry = await wireEntry(dir, 'src/index.ts', plan.integrations)
    expect(entry).toMatchObject({ added: ['queueAdapter'], manual: [] })

    expect(findEnvSchema(dir)).toBe('src/config/index.ts')
    const env = await wireEnv(dir, 'src/config/index.ts', plan.integrations)
    expect(env.added).toEqual(['REDIS_HOST', 'REDIS_PORT', 'REDIS_PASSWORD'])
    const schema = readFileSync(join(dir, 'src/config/index.ts'), 'utf-8')
    expect(schema).toContain(
      "    PORT: p,\n    REDIS_HOST: z.string().default('127.0.0.1'),\n    REDIS_PORT: z.coerce.number().default(6379),\n",
    )
    // A secret gets no default.
    expect(schema).toContain('    REDIS_PASSWORD: z.string().optional(),\n')

    // Again: nothing new.
    const again = await wireEnv(dir, 'src/config/index.ts', plan.integrations)
    expect(again.added).toEqual([])
    expect(again.present).toEqual(['REDIS_HOST', 'REDIS_PORT', 'REDIS_PASSWORD'])
  })

  it.each([
    ['valibot', 'v.object', "REDIS_HOST: v.optional(v.string(), '127.0.0.1')"],
    ['yup', 'yup.object', 'REDIS_PORT: yup.number().default(6379)'],
  ])('writes the %s entries for a %s schema', async (lib, object, expected) => {
    tmp()
    mkdirSync(join(dir, 'src/config'), { recursive: true })
    writeFileSync(join(dir, 'src/config/index.ts'), config(lib, object))
    await wireEnv(dir, 'src/config/index.ts', planWiring(['queue'])!.integrations)
    const schema = readFileSync(join(dir, 'src/config/index.ts'), 'utf-8')
    expect(schema).toContain(expected)
    expect(schema).not.toContain('z.')
  })
})

describe('kick add --entry', () => {
  it('stops before installing when the entry file does not exist', async () => {
    tmp()
    writeFileSync(join(dir, 'package.json'), '{ "name": "app" }')
    const { spawnSync } = await import('node:child_process')
    const cli = join(import.meta.dirname, '..', 'dist', 'cli.mjs')
    const result = spawnSync(
      'node',
      [cli, 'add', 'swagger', '--pm', 'pnpm', '--entry', 'src/nope.ts'],
      {
        cwd: dir,
        encoding: 'utf-8',
        env: { ...process.env, NO_COLOR: '1' },
      },
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('--entry src/nope.ts does not exist')
    expect(result.stdout).not.toContain('Installing')
  })
})
