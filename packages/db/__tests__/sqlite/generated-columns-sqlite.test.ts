/**
 * D.20 on SQLite: generated columns compute, and adding a stored one to a
 * table that has rows rebuilds it with the rows kept.
 */
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  checkDrift,
  diff,
  emitSqlite,
  extractSnapshot,
  integer,
  introspectSqlite,
  serial,
  table,
} from '@forinda/kickjs-db'

describe('generated columns on SQLite', () => {
  it('adds stored and virtual generated columns to a table with rows', async () => {
    const base = { id: serial().primaryKey(), a: integer().notNull() }
    const v1 = extractSnapshot({ t: table('t', base) }, 'sqlite')
    const v2 = extractSnapshot(
      {
        t: table('t', {
          id: serial().primaryKey(),
          a: integer().notNull(),
          twice: integer().generatedAlwaysAs('a * 2'),
          thrice: integer().generatedAlwaysAs('a * 3', { stored: false }),
        }),
      },
      'sqlite',
    )
    const db = new Database(':memory:')
    const empty = { version: 1 as const, dialect: 'sqlite' as const, tables: {} }
    db.exec(emitSqlite(diff(empty, v1), { from: empty, to: v1 }))
    db.prepare('INSERT INTO t (a) VALUES (?)').run(5)

    db.exec(emitSqlite(diff(v1, v2), { from: v1, to: v2 }))
    expect(db.prepare('SELECT id, a, twice, thrice FROM t').all()).toEqual([
      { id: 1, a: 5, twice: 10, thrice: 15 },
    ])
    const live = introspectSqlite(db)
    expect(live.tables.t.columns.twice.generated).toEqual({ expression: 'a * 2', stored: true })
    expect(live.tables.t.columns.thrice.generated).toEqual({ expression: 'a * 3', stored: false })
    await expect(checkDrift(live, v2, 'error')).resolves.toBeUndefined()
  })
})
