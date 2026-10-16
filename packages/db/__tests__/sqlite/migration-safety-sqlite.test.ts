/**
 * Migrations that lost data or failed: a rebuild that emptied child tables,
 * a column dropped before its index, a foreign key change never diffed, text
 * defaults that lost their quotes, and MySQL's MODIFY dropping AUTO_INCREMENT.
 */
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  bigSerial,
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
  varchar,
} from '@forinda/kickjs-db'
import {
  asyncSqliteAdapter,
  sqliteAdapter,
  type AsyncSqliteDriver,
} from '@forinda/kickjs-db/sqlite'

const snap = (s: Record<string, unknown>, dialect: 'sqlite' | 'postgres' | 'mysql' = 'sqlite') =>
  extractSnapshot(s, dialect)
const empty = { version: 1 as const, dialect: 'sqlite' as const, tables: {} }

function usersAndPosts(name: ReturnType<typeof text>, onDelete: 'cascade' | 'no_action') {
  const users = table('users', { id: serial().primaryKey(), name })
  const posts = table('posts', {
    id: serial().primaryKey(),
    userId: integer()
      .notNull()
      .references(() => users.id, { onDelete }),
  })
  return { users, posts }
}

describe('a SQLite table rebuild keeps the rows of tables that reference it', () => {
  for (const onDelete of ['cascade', 'no_action'] as const) {
    it(`with ON DELETE ${onDelete}`, async () => {
      const database = new Database(':memory:')
      database.pragma('foreign_keys = ON')
      const before = snap(usersAndPosts(text(), onDelete))
      database.exec(emitSqlite(diff(empty, before), { from: empty, to: before }))
      database.exec(
        `INSERT INTO users (name) VALUES ('ada'); INSERT INTO posts (userId) VALUES (1);`,
      )
      // name: nullable → not null with a default — an ALTER SQLite can only do by rebuilding.
      const after = snap(usersAndPosts(text().notNull().default('x'), onDelete))
      const sql = emitSqlite(diff(before, after), { from: before, to: after })
      expect(sql).toMatch(/_kick_new_users/)
      await sqliteAdapter({ database }).applyMigrationInTx!(sql, null)
      expect(database.prepare('SELECT count(*) AS n FROM posts').get()).toEqual({ n: 1 })
      // Foreign keys are back on afterwards.
      expect(database.pragma('foreign_keys', { simple: true })).toBe(1)
    })
  }

  it('is refused on an async driver with foreign keys on, rather than emptying the children', async () => {
    const database = new Database(':memory:')
    database.pragma('foreign_keys = ON')
    const driver: AsyncSqliteDriver = {
      async query(sql, params = []) {
        const stmt = database.prepare(sql)
        return stmt.reader ? stmt.all(...params) : (stmt.run(...params), [])
      },
      async batch(statements) {
        database.transaction(() => {
          for (const s of statements) {
            const stmt = database.prepare(s.sql)
            if (stmt.reader) stmt.all(...(s.params ?? []))
            else stmt.run(...(s.params ?? []))
          }
        })()
      },
    }
    const before = snap(usersAndPosts(text(), 'cascade'))
    database.exec(emitSqlite(diff(empty, before), { from: empty, to: before }))
    database.exec(`INSERT INTO users (name) VALUES ('ada'); INSERT INTO posts (userId) VALUES (1);`)
    const after = snap(usersAndPosts(text().notNull().default('x'), 'cascade'))
    const sql = emitSqlite(diff(before, after), { from: before, to: after })
    await expect(asyncSqliteAdapter({ driver }).applyMigrationInTx!(sql, null)).rejects.toThrow(
      /rebuilds a table other tables reference \(posts → users\)/,
    )
    expect(database.prepare('SELECT count(*) AS n FROM posts').get()).toEqual({ n: 1 })
  })
})

describe('the diff', () => {
  it('drops an index or a foreign key before the column it uses', () => {
    const was = { t: table('t', { id: serial().primaryKey(), email: text().unique() }) }
    const now = { t: table('t', { id: serial().primaryKey() }) }
    const kinds = diff(snap(was), snap(now)).map((c) => c.kind)
    expect(kinds.indexOf('dropIndex')).toBeLessThan(kinds.indexOf('dropColumn'))
    // And the SQL runs.
    const database = new Database(':memory:')
    const a = snap(was)
    const b = snap(now)
    database.exec(emitSqlite(diff(empty, a), { from: empty, to: a }))
    database.exec(emitSqlite(diff(a, b), { from: a, to: b }))
  })

  it('sees a foreign key whose action changed', () => {
    const a = snap(usersAndPosts(text(), 'cascade'))
    const b = snap(usersAndPosts(text(), 'no_action'))
    expect(diff(a, b).map((c) => c.kind)).toEqual(['dropForeignKey', 'addForeignKey'])
  })
})

describe('defaults', () => {
  const defaults = {
    t: table('t', {
      id: serial().primaryKey(),
      code: text().notNull().default('0800'),
      flag: varchar(10).notNull().default('true'),
      n: integer().notNull().default(5),
      lang: text().notNull().default('std::string'),
      meta: jsonb().notNull().default("'{}'::jsonb"),
    }),
  }

  it('keep a text default a string on SQLite', () => {
    const database = new Database(':memory:')
    const { meta: _meta, ...columns } = defaults.t.__columns
    const s = snap({ t: table('t', columns) })
    database.exec(emitSqlite(diff(empty, s), { from: empty, to: s }))
    database.exec('INSERT INTO t DEFAULT VALUES')
    expect(database.prepare('SELECT code, flag, n, lang FROM t').get()).toEqual({
      code: '0800',
      flag: 'true',
      n: 5,
      lang: 'std::string',
    })
  })

  it('are quoted by column type on MySQL and Postgres', () => {
    const my = emitMysql(diff({ ...empty, dialect: 'mysql' }, snap(defaults, 'mysql')))
    expect(my).toMatch(/`code` \w+(\(\d+\))? NOT NULL DEFAULT '0800'/)
    expect(my).toMatch(/`flag` VARCHAR\(10\) NOT NULL DEFAULT 'true'/)
    expect(my).toMatch(/`n` INT NOT NULL DEFAULT 5/)
    const pg = emitPg(diff({ ...empty, dialect: 'postgres' }, snap(defaults, 'postgres')))
    expect(pg).toMatch(/"lang" text NOT NULL DEFAULT 'std::string'/)
    expect(pg).toMatch(/"meta" jsonb NOT NULL DEFAULT '\{\}'::jsonb/)
  })
})

it("MySQL's MODIFY on a serial key keeps AUTO_INCREMENT", () => {
  const a = snap({ t: table('t', { id: serial().primaryKey() }) }, 'mysql')
  const b = snap({ t: table('t', { id: bigSerial().primaryKey() }) }, 'mysql')
  expect(emitMysql(diff(a, b))).toMatch(/MODIFY COLUMN `id` BIGINT NOT NULL AUTO_INCREMENT/)
})
