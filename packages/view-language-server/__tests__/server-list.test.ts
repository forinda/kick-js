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
  it('watches templates and the configured pipes and validators files', async () => {
    const { watchPatterns } = await import('../src/server')
    expect(watchPatterns('/app', '/app/src/views/filters.ts', '/app/src/views/checks.ts')).toEqual([
      '**/*.kick',
      '**/pipes.{ts,js}',
      '**/validators.{ts,js}',
      'src/views/filters.ts',
      'src/views/checks.ts',
    ])
    expect(
      watchPatterns('/app', '/app/src/views/pipes.ts', '/app/src/views/validators.ts'),
    ).toEqual(['**/*.kick', '**/pipes.{ts,js}', '**/validators.{ts,js}'])
  })
})

describe('listScripts', () => {
  it('finds TS / JS files, skipping dependencies, build output and dot folders', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kick-scripts-'))
    const file = (p: string) => {
      mkdirSync(join(dir, p, '..'), { recursive: true })
      writeFileSync(join(dir, p), '')
    }
    for (const p of [
      'src/a.ts',
      'src/modules/b.controller.tsx',
      'src/c.mjs',
      'src/views/home.kick',
      'src/d.d.ts',
      'node_modules/x/index.js',
      'dist/index.js',
      '.kickjs/types/routes.ts',
    ])
      file(p)
    vi.resetModules()
    vi.doUnmock('node:fs/promises')
    const { listScripts } = await import('../src/server')
    expect((await listScripts(dir)).map((p) => p.slice(dir.length + 1)).toSorted()).toEqual([
      'src/a.ts',
      'src/c.mjs',
      'src/modules/b.controller.tsx',
    ])
  })
})

describe('mapLimit', () => {
  it('keeps at most `limit` calls in flight, results in order', async () => {
    vi.resetModules()
    const { mapLimit } = await import('../src/server')
    let running = 0
    let peak = 0
    const out = await mapLimit([...Array(50).keys()], 4, async (n) => {
      peak = Math.max(peak, ++running)
      await new Promise((r) => setTimeout(r, 1))
      running--
      return n * 2
    })
    expect(peak).toBe(4)
    expect(out).toEqual([...Array(50).keys()].map((n) => n * 2))
  })
})
