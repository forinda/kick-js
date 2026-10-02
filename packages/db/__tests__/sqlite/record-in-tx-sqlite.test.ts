/**
 * A migration and its kick_migrations row commit together. If recording
 * fails, the migration's own changes roll back with it — so a crash between
 * the two can't leave it applied but unrecorded. Same on the way down.
 */
import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import {
  appendJournalEntry,
  computeMigrationHash,
  migrateDown,
  migrateLatest,
  migrateStatus,
} from '@forinda/kickjs-db'
import { sqliteAdapter } from '@forinda/kickjs-db/sqlite'

async function migration(dir: string, id: string, up: string, down = '') {
  const out = path.join(dir, id)
  await mkdir(out, { recursive: true })
  await writeFile(path.join(out, 'up.sql'), up)
  await writeFile(path.join(out, 'down.sql'), down)
  await writeFile(
    path.join(out, 'snapshot.json'),
    JSON.stringify({ version: 1, dialect: 'sqlite', tables: {} }),
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

const tables = (db: Database.Database) =>
  (
    db.prepare("select name from sqlite_master where type = 'table'").all() as { name: string }[]
  ).map((r) => r.name)

describe('a migration and its record commit together (SQLite)', () => {
  it('rolls the migration back when recording it fails', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'kickdb-rec-'))
    const database = new Database(':memory:')
    const adapter = sqliteAdapter({ database })
    // Recording fails because the migration removed the table it's recorded in.
    await migration(
      dir,
      '20260101_000000_x',
      'CREATE TABLE widgets (id INTEGER); DROP TABLE kick_migrations;',
    )

    await expect(
      migrateLatest({ adapter, migrationsDir: dir, driftCheck: 'ignore' }),
    ).rejects.toThrow()
    expect(tables(database)).toContain('kick_migrations')
    expect(tables(database)).not.toContain('widgets')
  })

  it('keeps the record when undoing fails part-way through', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'kickdb-rec-'))
    const database = new Database(':memory:')
    const adapter = sqliteAdapter({ database })
    await migration(
      dir,
      '20260101_000000_x',
      'CREATE TABLE widgets (id INTEGER);',
      'DROP TABLE widgets; DROP TABLE kick_migrations;',
    )
    await migrateLatest({ adapter, migrationsDir: dir, driftCheck: 'ignore' })

    await expect(migrateDown({ adapter, migrationsDir: dir })).rejects.toThrow()
    expect(tables(database)).toEqual(expect.arrayContaining(['widgets', 'kick_migrations']))
    const [s] = await migrateStatus({ adapter, migrationsDir: dir })
    expect(s!.state).toBe('applied')
  })
})
