/**
 * Migration errors say what went wrong: a failed migration names itself
 * (with the driver error as `cause`), and drift lists what drifted.
 */
import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import {
  MigrationDriftError,
  MigrationFailedError,
  appendJournalEntry,
  computeMigrationHash,
  migrateLatest,
  migrateStatus,
} from '@forinda/kickjs-db'
import { sqliteAdapter } from '@forinda/kickjs-db/sqlite'

async function migration(
  dir: string,
  id: string,
  up: string,
  tables: Record<string, unknown> = {},
) {
  const out = path.join(dir, id)
  await mkdir(out, { recursive: true })
  await writeFile(path.join(out, 'up.sql'), up)
  await writeFile(path.join(out, 'down.sql'), '')
  await writeFile(
    path.join(out, 'snapshot.json'),
    JSON.stringify({ version: 1, dialect: 'sqlite', tables }),
  )
  await writeFile(
    path.join(out, 'meta.json'),
    JSON.stringify({
      id,
      name: id,
      reviewed: true,
      dialect: 'sqlite',
      previousId: null,
      downIsDraft: false,
    }),
  )
  await appendJournalEntry(dir, 'sqlite', {
    id,
    tag: id,
    hash: await computeMigrationHash(out),
    createdAt: new Date().toISOString(),
  })
}

describe('migration errors', () => {
  it('a failed migration names itself and stays pending', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'kickdb-fail-'))
    const adapter = sqliteAdapter({ database: new Database(':memory:') })
    await migration(dir, '20260101_000000_ok', 'CREATE TABLE a (id INTEGER PRIMARY KEY);')
    await migration(dir, '20260102_000000_broken', 'INSERT INTO missing_table VALUES (1);')

    const err = await migrateLatest({ adapter, migrationsDir: dir, driftCheck: 'ignore' }).catch(
      (e) => e,
    )
    expect(err).toBeInstanceOf(MigrationFailedError)
    expect(err.message).toMatch(
      /^Migration 20260102_000000_broken failed: no such table: missing_table/,
    )
    expect(err.id).toBe('20260102_000000_broken')
    expect(err.cause).toBeInstanceOf(Error)

    const status = await migrateStatus({ adapter, migrationsDir: dir })
    expect(status.find((s) => s.id === '20260102_000000_broken')?.state).toBe('pending')
  })

  it('drift names what drifted', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'kickdb-drift-'))
    const database = new Database(':memory:')
    const adapter = sqliteAdapter({ database })
    await migration(dir, '20260101_000000_init', 'CREATE TABLE IF NOT EXISTS x (id INTEGER);')
    await migrateLatest({ adapter, migrationsDir: dir, driftCheck: 'ignore' })
    database.exec('CREATE TABLE sneaky (id INTEGER)')
    await migration(dir, '20260102_000000_next', 'SELECT 1;')

    const err = await migrateLatest({ adapter, migrationsDir: dir }).catch((e) => e)
    expect(err).toBeInstanceOf(MigrationDriftError)
    expect(err.message).toMatch(/added: .*sneaky/)
  })
})
