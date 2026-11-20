/** templateKey must work on every Node the package supports (Dirent.parentPath is 20.12+). */
import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

describe('templateKey', () => {
  it('hashes nested migration files without Dirent.parentPath', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'kick-tplkey-'))
    await mkdir(path.join(dir, 'a'), { recursive: true })
    await writeFile(path.join(dir, 'a', 'up.sql'), 'create table t (id int)')
    await writeFile(path.join(dir, '_journal.json'), '{}')
    vi.resetModules()
    vi.doMock('node:fs/promises', async (orig) => {
      const real = await orig<typeof import('node:fs/promises')>()
      // Node 20.0–20.11: no parentPath (and no path) on a Dirent, and no `recursive`.
      const readdir = (async (p: string, o?: { withFileTypes?: boolean; recursive?: boolean }) => {
        if (o?.recursive) throw new Error('recursive readdir is not supported here')
        const out = await real.readdir(p, { withFileTypes: true })
        return o?.withFileTypes
          ? out.map((d) =>
              Object.assign(
                Object.create(Object.getPrototypeOf(d)),
                { name: d.name, [Symbol.for('type')]: 0 },
                { isFile: () => d.isFile(), isDirectory: () => d.isDirectory() },
              ),
            )
          : out.map((d) => d.name)
      }) as typeof real.readdir
      return { ...real, readdir, default: { ...real, readdir } }
    })
    const { templateKey } = await import('../../src/testing')
    const key = await templateKey({ migrationsDir: dir })
    expect(key).toMatch(/^[0-9a-f]{12}$/)
    await writeFile(path.join(dir, 'a', 'up.sql'), 'create table t (id bigint)')
    expect(await templateKey({ migrationsDir: dir })).not.toBe(key)
    vi.doUnmock('node:fs/promises')
    await rm(dir, { recursive: true, force: true })
  })
})
