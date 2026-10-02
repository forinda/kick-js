/**
 * A table keyed by `serial()` — an inline INTEGER PRIMARY KEY on SQLite —
 * doesn't read as drift on the next migrate run.
 */
import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import {
  appendJournalEntry,
  computeMigrationHash,
  diff,
  emitSqlite,
  extractSnapshot,
  migrateLatest,
  serial,
  table,
  text,
  type SchemaSnapshot,
} from '@forinda/kickjs-db'
import { sqliteAdapter } from '@forinda/kickjs-db/sqlite'

async function writeMigration(dir: string, id: string, from: SchemaSnapshot, to: SchemaSnapshot) {
  const out = path.join(dir, id)
  await mkdir(out, { recursive: true })
  await writeFile(path.join(out, 'up.sql'), emitSqlite(diff(from, to), { from, to }))
  await writeFile(path.join(out, 'down.sql'), '')
  await writeFile(path.join(out, 'snapshot.json'), JSON.stringify(to))
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

describe('serial() keys on SQLite', () => {
  it('migrate twice without false drift', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'kickdb-serial-'))
    const adapter = sqliteAdapter({ database: new Database(':memory:') })
    const empty: SchemaSnapshot = { version: 1, dialect: 'sqlite', tables: {} }

    const v1 = extractSnapshot(
      { notes: table('notes', { id: serial().primaryKey(), body: text() }) },
      'sqlite',
    )
    await writeMigration(dir, '20260101_000000_init', empty, v1)
    await migrateLatest({ adapter, migrationsDir: dir })

    const v2 = extractSnapshot(
      { notes: table('notes', { id: serial().primaryKey(), body: text(), title: text() }) },
      'sqlite',
    )
    await writeMigration(dir, '20260102_000000_title', v1, v2)
    await expect(migrateLatest({ adapter, migrationsDir: dir })).resolves.toMatchObject({
      applied: ['20260102_000000_title'],
    })
  })
})
