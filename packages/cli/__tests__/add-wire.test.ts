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
  planWiring,
  wireEntry,
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
    // devtools is imported by the entry file, so it's a regular dependency here.
    expect(plan.dependencies).toEqual(
      expect.arrayContaining([
        '@forinda/kickjs-devtools',
        '@forinda/kickjs-queue',
        'bullmq',
        'ioredis',
      ]),
    )
    expect(plan.integrations.map((i) => i.import?.names?.[0])).toEqual([
      'DevToolsAdapter',
      'QueueAdapter',
    ])
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
    expect(changed).toEqual(['.env', '.env.example'])
    // The existing value is kept; only the missing key is added.
    expect(readFileSync(join(dir, '.env'), 'utf-8')).toBe(
      'PORT=3000\nREDIS_HOST=redis.internal\nREDIS_PORT=6379\n',
    )
    expect(readFileSync(join(dir, '.env.example'), 'utf-8')).toBe('REDIS_HOST=127.0.0.1\n')
    // Running again changes nothing.
    expect(
      await applyLayerFiles(dir, new Map([['.env', 'REDIS_HOST=127.0.0.1\nREDIS_PORT=6379\n']])),
    ).toEqual([])
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
    git('add', '-A')
    git('commit', '-qm', 'init')
    writeFileSync(join(dir, 'b.ts'), 'b')
    expect(dirtyFiles(dir, ['a.ts'])).toEqual([])
    writeFileSync(join(dir, 'a.ts'), 'changed')
    expect(dirtyFiles(dir, ['a.ts', '.env'])).toEqual(['a.ts'])
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
