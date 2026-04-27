import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  readJournal,
  appendJournalEntry,
  computeMigrationHash,
  verifyMigrationHash,
} from '@forinda/kickjs-db'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'kickdb-journal-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('journal', () => {
  it('readJournal returns an empty journal when the file is absent', async () => {
    const j = await readJournal(dir, 'postgres')
    expect(j).toEqual({ version: 1, dialect: 'postgres', entries: [] })
  })

  it('appendJournalEntry writes the file', async () => {
    const entry = {
      id: '20260427_init',
      tag: 'init',
      hash: 'sha256:abc',
      createdAt: '2026-04-27T00:00:00.000Z',
    }
    await appendJournalEntry(dir, 'postgres', entry)
    const j = await readJournal(dir, 'postgres')
    expect(j.entries).toEqual([entry])
  })

  it('appendJournalEntry preserves order across multiple appends', async () => {
    await appendJournalEntry(dir, 'postgres', {
      id: 'a',
      tag: 'a',
      hash: 'h1',
      createdAt: '2026-04-27T00:00:00.000Z',
    })
    await appendJournalEntry(dir, 'postgres', {
      id: 'b',
      tag: 'b',
      hash: 'h2',
      createdAt: '2026-04-27T00:01:00.000Z',
    })
    const j = await readJournal(dir, 'postgres')
    expect(j.entries.map((e) => e.id)).toEqual(['a', 'b'])
  })

  it('computeMigrationHash is deterministic across reads', async () => {
    const mig = path.join(dir, '20260427_init')
    await mkdir(mig, { recursive: true })
    await writeFile(path.join(mig, 'up.sql'), 'CREATE TABLE x;', 'utf8')
    await writeFile(path.join(mig, 'down.sql'), 'DROP TABLE x;', 'utf8')
    await writeFile(path.join(mig, 'snapshot.json'), '{"x":1}', 'utf8')
    const h1 = await computeMigrationHash(mig)
    const h2 = await computeMigrationHash(mig)
    expect(h1).toBe(h2)
    expect(h1).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('computeMigrationHash changes when any of the three files changes', async () => {
    const mig = path.join(dir, '20260427_init')
    await mkdir(mig, { recursive: true })
    await writeFile(path.join(mig, 'up.sql'), 'A', 'utf8')
    await writeFile(path.join(mig, 'down.sql'), 'B', 'utf8')
    await writeFile(path.join(mig, 'snapshot.json'), 'C', 'utf8')
    const baseline = await computeMigrationHash(mig)

    await writeFile(path.join(mig, 'up.sql'), 'A2', 'utf8')
    expect(await computeMigrationHash(mig)).not.toBe(baseline)
  })

  it('verifyMigrationHash returns true on match, false on mismatch', async () => {
    const mig = path.join(dir, '20260427_init')
    await mkdir(mig, { recursive: true })
    await writeFile(path.join(mig, 'up.sql'), 'A', 'utf8')
    await writeFile(path.join(mig, 'down.sql'), 'B', 'utf8')
    await writeFile(path.join(mig, 'snapshot.json'), 'C', 'utf8')
    const h = await computeMigrationHash(mig)
    await expect(verifyMigrationHash(mig, h)).resolves.toBe(true)
    await expect(verifyMigrationHash(mig, 'sha256:000')).resolves.toBe(false)
  })
})
