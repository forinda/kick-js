import { mkdtemp, writeFile } from 'node:fs/promises'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { diskStorage } from '../src/disk'

vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>()
  return { ...actual, readdir: vi.fn(actual.readdir) }
})

it('reads a big folder once while paging through it, and again once it changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kick-list-'))
  const names = Array.from({ length: 1000 }, (_, i) => `f${String(i).padStart(4, '0')}`)
  await Promise.all(names.map((name) => writeFile(join(root, name), 'x')))
  const files = diskStorage({ root })
  const readdir = vi.mocked(fs.readdir)
  readdir.mockClear()

  const seen: string[] = []
  let cursor: string | undefined
  do {
    const page = await files.list({ limit: 100, cursor })
    seen.push(...page.files.map((f) => f.key))
    cursor = page.cursor
  } while (cursor)
  expect(seen).toEqual(names)
  expect(readdir).toHaveBeenCalledTimes(1)

  // A file added mid-way: the folder's stamp changes, so the next page sees it.
  const first = await files.list({ limit: 10 })
  await writeFile(join(root, 'f0005a'), 'x')
  await writeFile(join(root, 'a-first'), 'x')
  const next = await files.list({ limit: 3, cursor: first.cursor })
  expect(next.files.map((f) => f.key)).toEqual(['f0010', 'f0011', 'f0012'])
  expect((await files.list({ limit: 7 })).files.map((f) => f.key)).toEqual([
    'a-first',
    'f0000',
    'f0001',
    'f0002',
    'f0003',
    'f0004',
    'f0005',
  ])
  expect((await files.list({ limit: 1, cursor: 'f0005' })).files[0].key).toBe('f0005a')
  expect(readdir).toHaveBeenCalledTimes(2)
})
