/**
 * D.17 on SQLite: a table and a column named as renames keep their rows,
 * even when the renamed column's type changes too (a table rebuild).
 */
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  diff,
  emitSqlite,
  invertChanges,
  extractSnapshot,
  integer,
  serial,
  table,
  text,
} from '@forinda/kickjs-db'

describe('renames on SQLite', () => {
  it('keeps the data through a table rename and a column rename with a type change', () => {
    const v1 = extractSnapshot(
      {
        users: table('users', {
          id: serial().primaryKey(),
          fullName: text().notNull(),
          age: text(),
        }),
      },
      'sqlite',
    )
    const v2 = extractSnapshot(
      {
        people: table('people', {
          id: serial().primaryKey(),
          name: text().notNull(),
          age: integer(),
        }),
      },
      'sqlite',
    )
    const db = new Database(':memory:')
    const empty = { version: 1 as const, dialect: 'sqlite' as const, tables: {} }
    db.exec(emitSqlite(diff(empty, v1), { from: empty, to: v1 }))
    db.prepare(`INSERT INTO users (fullName, age) VALUES ('Ada', '36')`).run()

    const changes = diff(v1, v2, {
      renames: { tables: { users: 'people' }, columns: { 'people.fullName': 'name' } },
      explicitRenames: true,
    })
    db.exec(emitSqlite(changes, { from: v1, to: v2 }))
    expect(db.prepare('SELECT id, name, age FROM people').all()).toEqual([
      { id: 1, name: 'Ada', age: 36 },
    ])

    // And back down.
    db.exec(emitSqlite(invertChanges(changes), { from: v2, to: v1 }))
    expect(db.prepare('SELECT id, fullName, age FROM users').all()).toEqual([
      { id: 1, fullName: 'Ada', age: '36' },
    ])
  })
})
