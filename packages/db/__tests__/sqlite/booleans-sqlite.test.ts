/**
 * Booleans on SQLite: `boolean()` columns are typed `boolean`, but SQLite
 * stores 1 / 0 and better-sqlite3 refused to bind `true`. They now write,
 * compare and read back as booleans.
 */
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { sql } from 'kysely'
import {
  boolean,
  createDbClient,
  diff,
  emitSqlite,
  extractSnapshot,
  serial,
  table,
  text,
} from '@forinda/kickjs-db'
import { sqliteDialect } from '@forinda/kickjs-db/sqlite'

const posts = table('posts', {
  id: serial().primaryKey(),
  title: text().notNull(),
  published: boolean().notNull().default(false),
  pinned: boolean(),
})
const schema = { posts }

function make() {
  const database = new Database(':memory:')
  const empty = { version: 1 as const, dialect: 'sqlite' as const, tables: {} }
  const target = extractSnapshot(schema, 'sqlite')
  database.exec(emitSqlite(diff(empty, target), { from: empty, to: target }))
  return createDbClient({ schema, dialect: sqliteDialect({ database }) })
}

describe('booleans on SQLite', () => {
  it('write, filter and read back as booleans', async () => {
    const db = make()
    for (const post of [
      { title: 'a', published: true },
      { title: 'b' },
      { title: 'c', pinned: true },
    ]) {
      await db.insertInto('posts').values(post).execute()
    }
    await db.updateTable('posts').set({ pinned: false }).where('title', '=', 'b').execute()

    const rows = await db.selectFrom('posts').selectAll().orderBy('id').execute()
    expect(rows.map((r) => [r.title, r.published, r.pinned])).toEqual([
      ['a', true, null],
      ['b', false, false],
      ['c', false, true],
    ])

    const published = await db
      .selectFrom('posts')
      .select('title')
      .where('published', '=', true)
      .execute()
    expect(published.map((r) => r.title)).toEqual(['a'])

    const raw = await sql<{
      n: number
    }>`select count(*) as n from posts where pinned = ${true}`.execute(db.qb)
    expect(raw.rows[0]!.n).toBe(1)
  })
})
