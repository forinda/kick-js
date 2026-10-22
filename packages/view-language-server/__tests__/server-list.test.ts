import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

describe('listKick', () => {
  it("doesn't need Dirent.parentPath (Node < 20.12)", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kick-list-'))
    mkdirSync(join(dir, 'components'))
    writeFileSync(join(dir, 'a.kick'), '')
    writeFileSync(join(dir, 'components/b.kick'), '')
    writeFileSync(join(dir, 'pipes.ts'), '')
    vi.resetModules()
    vi.doMock('node:fs/promises', async (orig) => {
      const fs = await orig<typeof import('node:fs/promises')>()
      // Older Node: no parentPath / path on Dirent.
      const readdir = async (...args: Parameters<typeof fs.readdir>) => {
        const out = (await (fs.readdir as Function)(...args)) as unknown[]
        return out.map((e) =>
          typeof e === 'string'
            ? e
            : Object.assign(Object.create(Object.getPrototypeOf(e)), e, {
                parentPath: undefined,
                path: undefined,
              }),
        )
      }
      return { ...fs, readdir }
    })
    const { listKick } = await import('../src/server')
    expect((await listKick(dir)).toSorted()).toEqual([
      join(dir, 'a.kick'),
      join(dir, 'components/b.kick'),
    ])
    vi.doUnmock('node:fs/promises')
  })
})

describe('watchPatterns', () => {
  it('watches templates and the configured pipes file', async () => {
    const { watchPatterns } = await import('../src/server')
    expect(watchPatterns('/app', '/app/src/views/filters.ts')).toEqual([
      '**/*.kick',
      '**/pipes.{ts,js}',
      'src/views/filters.ts',
    ])
    expect(watchPatterns('/app', '/app/src/views/pipes.ts')).toEqual([
      '**/*.kick',
      '**/pipes.{ts,js}',
    ])
  })
})
