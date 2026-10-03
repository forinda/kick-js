/** D.25: views and materialized views through snapshot, diff, invert, emit and render. */
import { describe, expect, it } from 'vitest'
import {
  diff,
  emitMysql,
  emitPg,
  emitSqlite,
  extractSnapshot,
  integer,
  invertChanges,
  renderSchemaSource,
  serial,
  table,
  text,
  unique,
  varchar,
  view,
} from '@forinda/kickjs-db'
import { materializedView } from '@forinda/kickjs-db/pg'

const users = table('users', {
  id: serial().primaryKey(),
  email: varchar(100).notNull(),
  active: integer().notNull(),
})
const activeUsers = view(
  'active_users',
  { id: integer().notNull(), email: text().notNull() },
  { as: 'SELECT id, email FROM users WHERE active = 1;' },
)
const activeEmails = view(
  'active_emails',
  { email: text().notNull() },
  { as: 'SELECT email FROM active_users' },
)
const empty = (dialect: 'postgres' | 'mysql' | 'sqlite') => ({
  version: 1 as const,
  dialect,
  tables: {},
})

describe('views', () => {
  it('are snapshotted apart from tables, in declaration order', () => {
    const snap = extractSnapshot({ users, activeUsers, activeEmails }, 'postgres')
    expect(Object.keys(snap.tables)).toEqual(['users'])
    expect(Object.keys(snap.views!)).toEqual(['active_users', 'active_emails'])
    expect(snap.views!.active_users.definition).toBe('SELECT id, email FROM users WHERE active = 1')
    expect(extractSnapshot({ users }, 'postgres').views).toBeUndefined()
  })

  it('are created after the tables they select from', () => {
    const kinds = diff(
      empty('postgres'),
      extractSnapshot({ users, activeUsers, activeEmails }, 'postgres'),
    ).map((c) => (c.kind === 'createView' ? `view:${c.view.name}` : c.kind))
    expect(kinds).toEqual(['createTable', 'view:active_users', 'view:active_emails'])
  })

  it('are dropped and re-created around a change to a table they name, dependents too', () => {
    const widened = table('users', {
      id: serial().primaryKey(),
      email: varchar(200).notNull(),
      active: integer().notNull(),
    })
    const changes = diff(
      extractSnapshot({ users, activeUsers, activeEmails }, 'postgres'),
      extractSnapshot({ users: widened, activeUsers, activeEmails }, 'postgres'),
    )
    expect(changes.map((c) => ('view' in c ? `${c.kind}:${c.view.name}` : c.kind))).toEqual([
      'dropView:active_emails',
      'dropView:active_users',
      'alterColumn',
      'createView:active_users',
      'createView:active_emails',
    ])
    // An index or comment change leaves them alone.
    const indexed = table('users', {
      id: serial().primaryKey(),
      email: varchar(100).notNull().comment('x'),
      active: integer().notNull(),
    })
    expect(
      diff(
        extractSnapshot({ users, activeUsers }, 'postgres'),
        extractSnapshot({ users: indexed, activeUsers }, 'postgres'),
      ).map((c) => c.kind),
    ).toEqual(['setColumnComment'])
  })

  it('re-create on a new definition, and invert', () => {
    const changed = view(
      'active_users',
      { id: integer().notNull(), email: text().notNull() },
      { as: 'SELECT id, email FROM users WHERE active <> 0' },
    )
    const forward = diff(
      extractSnapshot({ users, activeUsers }, 'postgres'),
      extractSnapshot({ users, activeUsers: changed }, 'postgres'),
    )
    expect(emitPg(forward)).toBe(
      'DROP VIEW "active_users";\nCREATE VIEW "active_users" AS\nSELECT id, email FROM users WHERE active <> 0;',
    )
    expect(emitPg(invertChanges(forward))).toContain('WHERE active = 1;')
  })

  it('emit for each dialect; materialized views are Postgres-only', () => {
    expect(
      emitMysql(diff(empty('mysql'), extractSnapshot({ users, activeUsers }, 'mysql'))),
    ).toContain('CREATE VIEW `active_users` AS\nSELECT id, email FROM users WHERE active = 1;')
    const daily = materializedView(
      'daily',
      { n: integer().notNull() },
      {
        as: 'SELECT count(*)::int AS n FROM users',
        constraints: (t) => ({ one: unique('daily_n').on(t.n) }),
      },
    )
    const pg = emitPg(diff(empty('postgres'), extractSnapshot({ users, daily }, 'postgres')))
    expect(pg).toContain(
      'CREATE MATERIALIZED VIEW "daily" AS\nSELECT count(*)::int AS n FROM users\nWITH DATA;',
    )
    expect(pg).toContain('CREATE UNIQUE INDEX "daily_n" ON "daily" ("n");')
    expect(() => extractSnapshot({ daily }, 'sqlite')).toThrow(/only Postgres/)
  })

  it('on SQLite are re-created after a table rebuild', () => {
    const rebuilt = table('users', {
      id: serial().primaryKey(),
      email: varchar(100).notNull(),
      active: integer().notNull().default(1),
    })
    const from = extractSnapshot({ users, activeUsers }, 'sqlite')
    const to = extractSnapshot({ users: rebuilt, activeUsers }, 'sqlite')
    const sql = emitSqlite(diff(from, to), { from, to })
    expect(sql.indexOf('DROP VIEW "active_users"')).toBeLessThan(sql.indexOf('_kick_new_users'))
    expect(sql.lastIndexOf('CREATE VIEW "active_users"')).toBeGreaterThan(
      sql.lastIndexOf('_kick_new_users'),
    )
  })

  it('render back into the schema', () => {
    const snap = extractSnapshot({ users }, 'postgres')
    snap.views = {
      active_users: {
        name: 'active_users',
        definition: 'SELECT id FROM users WHERE note = `x`',
        columns: {
          id: { name: 'id', type: 'integer', nullable: true, default: null, primaryKey: false },
        },
      },
    }
    const src = renderSchemaSource(snap)
    expect(src).toContain(
      "import { table, integer, serial, varchar, view } from '@forinda/kickjs-db'",
    )
    expect(src).toContain("export const active_users = view('active_users', {")
    expect(src).toContain('as: `SELECT id FROM users WHERE note = \\`x\\``')
  })
})
