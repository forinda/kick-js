/**
 * `uuid().defaultRandom()` on SQLite fills the column with a canonical v4
 * UUID — the same shape Postgres' gen_random_uuid() returns, so request
 * validation that checks for a UUID accepts ids SQLite generated.
 */
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { diff, emitSqlite, extractSnapshot, table, text, uuid } from '@forinda/kickjs-db'

describe('uuid().defaultRandom() on SQLite', () => {
  it('generates distinct v4 UUIDs', () => {
    const items = table('items', { id: uuid().primaryKey().defaultRandom(), name: text() })
    const database = new Database(':memory:')
    const empty = { version: 1 as const, dialect: 'sqlite' as const, tables: {} }
    const target = extractSnapshot({ items }, 'sqlite')
    database.exec(emitSqlite(diff(empty, target), { from: empty, to: target }))

    const insert = database.prepare('INSERT INTO items (name) VALUES (?) RETURNING id')
    const ids = Array.from({ length: 200 }, () => (insert.get('x') as { id: string }).id)

    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    }
    expect(new Set(ids).size).toBe(ids.length)
  })
})
