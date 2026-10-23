/** `.default()` with a JSON value or a Date: stored as its text, never `[object Object]`. */
import { describe, expect, it } from 'vitest'
import {
  diff,
  emitMysql,
  emitPg,
  emitSqlite,
  extractSnapshot,
  jsonb,
  serial,
  table,
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
    expect(sql).toContain(`DEFAULT '2026-01-02T03:04:05.000Z'`)
  })

  it('MySQL', () => {
    const sql = emitMysql(diff(empty('mysql'), extractSnapshot(schema, 'mysql')))
    expect(sql).not.toContain('[object Object]')
    expect(sql).toContain(`DEFAULT ('{}')`)
  })

  it('SQLite', () => {
    const sql = emitSqlite(diff(empty('sqlite'), extractSnapshot(schema, 'sqlite')))
    expect(sql).not.toContain('[object Object]')
    expect(sql).toContain(`DEFAULT '{}'`)
  })
})
