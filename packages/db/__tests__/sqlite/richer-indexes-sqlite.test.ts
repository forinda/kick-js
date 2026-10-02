/**
 * D.9 richer indexes on SQLite: partial and expression indexes apply and
 * enforce, and introspection reads the predicate back without drift.
 */
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  checkDrift,
  diff,
  emitSqlite,
  extractSnapshot,
  index,
  introspectSqlite,
  serial,
  table,
  text,
  unique,
} from '@forinda/kickjs-db'

const users = table(
  'users',
  { id: serial().primaryKey(), email: text().notNull(), deletedAt: text() },
  (t) => ({
    active: unique('users_email_active').on(t.email).where('deletedAt IS NULL'),
    lower: index('users_email_lower').on('lower(email)'),
  }),
)

describe('richer indexes on SQLite', () => {
  it('applies, enforces and introspects without drift', async () => {
    const db = new Database(':memory:')
    const empty = { version: 1 as const, dialect: 'sqlite' as const, tables: {} }
    const target = extractSnapshot({ users }, 'sqlite')
    db.exec(emitSqlite(diff(empty, target), { from: empty, to: target }))

    const insert = db.prepare('INSERT INTO users (email, deletedAt) VALUES (?, ?)')
    insert.run('a@x.io', '2026-01-01')
    insert.run('a@x.io', null)
    expect(() => insert.run('a@x.io', null)).toThrow(/UNIQUE/)

    const plan = db
      .prepare(`EXPLAIN QUERY PLAN SELECT id FROM users WHERE lower(email) = 'a@x.io'`)
      .all()
    expect(JSON.stringify(plan)).toContain('users_email_lower')

    const live = introspectSqlite(db)
    const active = live.tables.users.indexes.find((i) => i.name === 'users_email_active')
    expect(active).toMatchObject({ unique: true, columns: ['email'], where: 'deletedAt IS NULL' })
    await expect(checkDrift(live, target, 'error')).resolves.toBeUndefined()
  })
})
