/**
 * `kick db seed` — seed files run in name order, by name, and fail loudly.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { KickDbError, listSeeds, runSeeds } from '@forinda/kickjs-db'

const g = globalThis as { __seedLog?: string[] }

async function seedsDir(files: Record<string, string>) {
  const dir = await mkdtemp(path.join(tmpdir(), 'kickdb-seeds-'))
  for (const [name, body] of Object.entries(files)) await writeFile(path.join(dir, name), body)
  return dir
}

const logs = (name: string) =>
  `export default async () => { globalThis.__seedLog.push('${name}') }\n`

beforeEach(() => {
  g.__seedLog = []
})

describe('runSeeds()', () => {
  it('runs every seed in name order, skipping non-seed files', async () => {
    const dir = await seedsDir({
      '02_posts.mjs': logs('posts'),
      '01_users.mjs': logs('users'),
      'README.md': '# not a seed',
      'types.d.ts': 'export {}',
    })
    expect(await listSeeds(dir)).toEqual(['01_users.mjs', '02_posts.mjs'])
    expect(await runSeeds({ dir })).toEqual({ ran: ['01_users.mjs', '02_posts.mjs'] })
    expect(g.__seedLog).toEqual(['users', 'posts'])
  })

  it('runs only the named seeds, with or without the extension', async () => {
    const dir = await seedsDir({ '01_users.mjs': logs('users'), '02_posts.mjs': logs('posts') })
    await runSeeds({ dir, names: ['02_posts'] })
    expect(g.__seedLog).toEqual(['posts'])
  })

  it('refuses a name that matches no seed', async () => {
    const dir = await seedsDir({ '01_users.mjs': logs('users') })
    await expect(runSeeds({ dir, names: ['nope'] })).rejects.toThrow(/No seed named nope/)
    expect(g.__seedLog).toEqual([])
  })

  it('refuses a seed without a default-exported function', async () => {
    const dir = await seedsDir({ 'bad.mjs': 'export const seed = () => {}\n' })
    await expect(runSeeds({ dir })).rejects.toThrow(/must default-export a function/)
  })

  it('names the seed that failed, keeps the cause, and stops', async () => {
    const dir = await seedsDir({
      '01_ok.mjs': logs('ok'),
      '02_boom.mjs': "export default async () => { throw new Error('no roles table') }\n",
      '03_after.mjs': logs('after'),
    })
    const err = await runSeeds({ dir }).catch((e) => e)
    expect(err).toBeInstanceOf(KickDbError)
    expect(err.message).toBe('Seed 02_boom.mjs failed: no roles table')
    expect(err.cause).toBeInstanceOf(Error)
    expect(g.__seedLog).toEqual(['ok'])
  })

  it('treats a missing folder as no seeds', async () => {
    expect(await runSeeds({ dir: path.join(tmpdir(), 'kickdb-no-such-dir') })).toEqual({ ran: [] })
  })
})
