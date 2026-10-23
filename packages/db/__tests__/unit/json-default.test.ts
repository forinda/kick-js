/** `.default()` with a JSON value or a Date: stored as its text, never `[object Object]`. */
import { describe, expect, it } from 'vitest'
import {
  diff,
  emitMysql,
  emitPg,
  emitSqlite,
  extractSnapshot,
  integer,
  jsonb,
  serial,
  table,
  text,
  timestamp,
} from '@forinda/kickjs-db'

const schema = {
  docs: table('docs', {
    id: serial().primaryKey(),
    meta: jsonb<{ tags?: string[] }>().notNull().default({}),
    tags: jsonb<string[]>().notNull().default(['a', "it's"]),
    since: timestamp().default(new Date('2026-01-02T03:04:05.000Z')),
  }),
}
const arrays = {
  lists: table('lists', {
    id: serial().primaryKey(),
    nums: integer().array().default([1, 2]),
    words: text().array().default(['a', 'b c', 'say "hi"', 'back\\slash']),
  }),
}
const empty = (dialect: 'postgres' | 'mysql' | 'sqlite') => ({
  version: 1 as const,
  dialect,
  tables: {},
})

describe('.default() with JSON values and dates', () => {
  it('Postgres', () => {
    const sql = emitPg(diff(empty('postgres'), extractSnapshot(schema, 'postgres')))
    expect(sql).not.toContain('[object Object]')
    expect(sql).toMatch(/"meta" jsonb NOT NULL DEFAULT '\{\}'/)
    expect(sql).toContain(`DEFAULT '["a","it''s"]'`)
    expect(sql).toContain(`DEFAULT '2026-01-02 03:04:05.000+00:00'`)
  })

  it('Postgres arrays take array literals, not JSON', () => {
    const sql = emitPg(diff(empty('postgres'), extractSnapshot(arrays, 'postgres')))
    expect(sql).toContain(`DEFAULT '{1,2}'`)
    expect(sql).toContain(`DEFAULT '{"a","b c","say \\"hi\\"","back\\\\slash"}'`)
  })

  it('MySQL', () => {
    const sql = emitMysql(diff(empty('mysql'), extractSnapshot(schema, 'mysql')))
    expect(sql).not.toContain('[object Object]')
    expect(sql).toContain(`DEFAULT ('{}')`)
    // MySQL rejects ISO's `T` and `Z`.
    expect(sql).toContain(`DEFAULT '2026-01-02 03:04:05.000+00:00'`)
  })

  it('SQLite', () => {
    const sql = emitSqlite(diff(empty('sqlite'), extractSnapshot(schema, 'sqlite')))
    expect(sql).not.toContain('[object Object]')
    expect(sql).toContain(`DEFAULT '{}'`)
  })
})
