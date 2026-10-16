/**
 * Migrations that lost data or failed: a rebuild that emptied child tables,
 * a column dropped before its index, a foreign key change never diffed, text
 * defaults that lost their quotes, and MySQL's MODIFY dropping AUTO_INCREMENT.
 */
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  bigSerial,
  checkDrift,
  date,
  diff,
  invertChanges,
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
import { isFunctionCall } from '../../src/emit/identifiers'
import { tinyint } from '../../src/dsl/columns/mysql'

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
      /rebuilds or drops a table other tables reference \(posts → users\)/,
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
    expect(my).toMatch(/`code` TEXT NOT NULL DEFAULT \('0800'\)/)
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

describe('dropping tables', () => {
  const accounts = table('accounts', { id: serial().primaryKey() })
  const members = table('members', {
    id: serial().primaryKey(),
    accountId: integer().references(() => accounts.id),
  })
  const notes = table('notes', {
    id: serial().primaryKey(),
    memberId: integer().references(() => members.id),
  })

  it("drops a kept table's foreign key to a dropped table first, and a child before its parent", () => {
    const users = (withAccount: boolean) =>
      table('users', {
        id: serial().primaryKey(),
        ...(withAccount ? { accountId: integer().references(() => accounts.id) } : {}),
      })
    const a = snap({ accounts, members, notes, users: users(true) }, 'postgres')
    const b = snap({ users: users(false) }, 'postgres')
    const order = diff(a, b).map((c) =>
      c.kind === 'dropTable' ? `dropTable:${c.table.name}` : c.kind,
    )
    expect(order.indexOf('dropForeignKey')).toBeLessThan(order.indexOf('dropTable:accounts'))
    expect(order.indexOf('dropTable:notes')).toBeLessThan(order.indexOf('dropTable:members'))
    expect(order.indexOf('dropTable:members')).toBeLessThan(order.indexOf('dropTable:accounts'))
    // Only once, not again from the table's own diff.
    expect(order.filter((k) => k === 'dropForeignKey')).toHaveLength(1)
  })
})

describe('expression defaults', () => {
  it('are parenthesised on SQLite, which takes no bare function call', () => {
    const s = snap({
      t: table('t', { id: serial().primaryKey(), r: integer().default('random()') }),
    })
    const sql = emitSqlite(diff(empty, s), { from: empty, to: s })
    expect(sql).toMatch(/DEFAULT \(random\(\)\)/)
    new Database(':memory:').exec(sql)
  })

  it('on MySQL: parenthesised, a literal on TEXT/JSON in parentheses, backslashes escaped', () => {
    const my = emitMysql(
      diff(
        { ...empty, dialect: 'mysql' },
        snap(
          {
            t: table('t', {
              id: serial().primaryKey(),
              r: integer().default('rand()'),
              doc: jsonb().notNull().default('{}'),
              body: text().notNull().default('hi'),
              path: varchar(20).notNull().default('C:\\temp'),
            }),
          },
          'mysql',
        ),
      ),
    )
    expect(my).toMatch(/`r` INT DEFAULT \(rand\(\)\)/)
    expect(my).toMatch(/`doc` JSON NOT NULL DEFAULT \('\{\}'\)/)
    expect(my).toMatch(/`body` TEXT NOT NULL DEFAULT \('hi'\)/)
    expect(my).toContain("`path` VARCHAR(20) NOT NULL DEFAULT 'C:\\\\temp'")
  })
})

describe('a default that nests calls', () => {
  it('is one function call when its parentheses balance to the end', () => {
    for (const yes of ['now()', 'floor(rand() * 10)', "nextval('a(b'::regclass)", "f('it''s )')"]) {
      expect(isFunctionCall(yes), yes).toBe(true)
    }
    // A backslash-escaped quote (MySQL, Postgres E'') would end the string early there.
    const escaped = "f('\\', '); delete from users; -- ')"
    for (const no of ['a() + b()', 'floor(rand()', '0800', 'std::string', "f(')')x", escaped]) {
      expect(isFunctionCall(no), no).toBe(false)
    }
  })

  it('runs as an expression on SQLite, and Postgres emits it bare', () => {
    const t = {
      t: table('t', {
        id: serial().primaryKey(),
        n: integer().notNull().default('abs(random() % 1)'),
      }),
    }
    const s = snap(t)
    const sql = emitSqlite(diff(empty, s), { from: empty, to: s })
    expect(sql).toMatch(/DEFAULT \(abs\(random\(\) % 1\)\)/)
    const database = new Database(':memory:')
    database.exec(sql)
    database.exec('INSERT INTO t DEFAULT VALUES')
    expect(database.prepare('SELECT n FROM t').get()).toEqual({ n: 0 })
    const pg = emitPg(diff({ ...empty, dialect: 'postgres' }, snap(t, 'postgres')))
    expect(pg).toMatch(/"n" integer NOT NULL DEFAULT abs\(random\(\) % 1\)/)
  })
})

describe('renames and foreign keys', () => {
  const owners = table('owners', { id: serial().primaryKey() })
  const docs = (col: 'ownerId' | 'authorId') =>
    table('docs', {
      id: serial().primaryKey(),
      [col]: integer().references(() => owners.id, { name: 'docs_owner_fk' }),
    })

  it('a renamed column keeps its foreign key: no drop and re-add, and down renames back first', () => {
    const a = snap({ owners, docs: docs('ownerId') }, 'postgres')
    const b = snap({ owners, docs: docs('authorId') }, 'postgres')
    const up = diff(a, b, { renames: { tables: {}, columns: { 'docs.ownerId': 'authorId' } } })
    expect(up.map((c) => c.kind)).toEqual(['renameColumn'])
    expect(invertChanges(up).map((c) => c.kind)).toEqual(['renameColumn'])
  })

  it("a renamed parent key column doesn't drop the child's foreign key", () => {
    const parent = (key: 'id' | 'uid') => table('users', { [key]: serial().primaryKey() })
    const child = (p: ReturnType<typeof parent>, key: 'id' | 'uid') =>
      table('posts', {
        id: serial().primaryKey(),
        userId: integer().references(() => (p as any)[key]),
      })
    const pa = parent('id')
    const pb = parent('uid')
    const a = snap({ posts: child(pa, 'id'), users: pa }, 'postgres')
    const b = snap({ posts: child(pb, 'uid'), users: pb }, 'postgres')
    const kinds = diff(a, b, { renames: { tables: {}, columns: { 'users.id': 'uid' } } }).map(
      (c) => c.kind,
    )
    expect(kinds).not.toContain('dropForeignKey')
    expect(kinds).not.toContain('addForeignKey')
  })

  it('down re-creates a dropped table with its foreign keys, after both tables exist', () => {
    const orgs = table('orgs', { id: serial().primaryKey() })
    const teams = table('teams', {
      id: serial().primaryKey(),
      orgId: integer().references(() => orgs.id),
    })
    const a = snap({ orgs, teams }, 'postgres')
    const b = snap({}, 'postgres')
    const down = invertChanges(diff(a, b)).map((c) =>
      c.kind === 'createTable' ? `create:${c.table.name}` : c.kind,
    )
    expect(down).toEqual(['create:orgs', 'create:teams', 'addForeignKey'])
  })
})

describe('cast and numeric defaults', () => {
  it('Postgres passes a cast of a call, literal or array through, and quotes anything else with ::', () => {
    const t = table('t', {
      id: text().notNull().default('gen_random_uuid()::text'),
      day: date().notNull().default('now()::date'),
      tags: text().notNull().default('ARRAY[]::text[]'),
      meta: jsonb().notNull().default("'{}'::jsonb"),
      lang: text().notNull().default('std::string'),
      sneaky: text().notNull().default("'1'::int primary key"),
      code: varchar(10).notNull().default("'x'::varchar(10)"),
      amount: text().notNull().default("'1.50'::numeric(10, 2)"),
      odd: text().notNull().default(`'a'::"my-type"`),
    })
    const pg = emitPg(diff({ ...empty, dialect: 'postgres' }, snap({ t }, 'postgres')))
    expect(pg).toContain('"id" text NOT NULL DEFAULT gen_random_uuid()::text')
    expect(pg).toContain('"day" date NOT NULL DEFAULT now()::date')
    expect(pg).toContain('"tags" text NOT NULL DEFAULT ARRAY[]::text[]')
    expect(pg).toContain(`"meta" jsonb NOT NULL DEFAULT '{}'::jsonb`)
    expect(pg).toContain(`"lang" text NOT NULL DEFAULT 'std::string'`)
    expect(pg).toContain(`"sneaky" text NOT NULL DEFAULT '''1''::int primary key'`)
    expect(pg).toContain(`"code" varchar(10) NOT NULL DEFAULT 'x'::varchar(10)`)
    expect(pg).toContain(`"amount" text NOT NULL DEFAULT '1.50'::numeric(10, 2)`)
    expect(pg).toContain(`"odd" text NOT NULL DEFAULT 'a'::"my-type"`)
  })

  it('MySQL renders a boolean default on a tinyint as a number', () => {
    const my = emitMysql(
      diff(
        { ...empty, dialect: 'mysql' },
        snap(
          {
            t: table('t', {
              id: serial().primaryKey(),
              on: tinyint()
                .notNull()
                .default(true as never),
            }),
          },
          'mysql',
        ),
      ),
    )
    expect(my).toMatch(/`on` TINYINT NOT NULL DEFAULT 1/)
  })
})

describe('async SQLite: a drop or rebuild that would cascade', () => {
  const driverFor = (database: Database.Database): AsyncSqliteDriver => ({
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
  })
  const setup = (before: Record<string, unknown>) => {
    const database = new Database(':memory:')
    database.pragma('foreign_keys = ON')
    const a = snap(before)
    database.exec(emitSqlite(diff(empty, a), { from: empty, to: a }))
    return { database, a }
  }

  it('runs when the referencing table is dropped in the same migration', async () => {
    const { database, a } = setup(usersAndPosts(text(), 'cascade'))
    const b = snap({ users: usersAndPosts(text().notNull().default('x'), 'cascade').users })
    const sql = emitSqlite(diff(a, b), { from: a, to: b })
    await asyncSqliteAdapter({ driver: driverFor(database) }).applyMigrationInTx!(sql, null)
  })

  it('refuses dropping a table a kept table cascades from', async () => {
    const orgs = table('orgs', { id: serial().primaryKey() })
    const members = (withKey: boolean) =>
      table('members', {
        id: serial().primaryKey(),
        ...(withKey ? { orgId: integer().references(() => orgs.id, { onDelete: 'cascade' }) } : {}),
      })
    const { database, a } = setup({ orgs, members: members(true) })
    database.exec('INSERT INTO orgs DEFAULT VALUES; INSERT INTO members (orgId) VALUES (1);')
    const b = snap({ members: members(false) })
    const sql = emitSqlite(diff(a, b), { from: a, to: b })
    await expect(
      asyncSqliteAdapter({ driver: driverFor(database) }).applyMigrationInTx!(sql, null),
    ).rejects.toThrow(/rebuilds or drops a table other tables reference \(members → orgs\)/)
    expect(database.prepare('SELECT count(*) AS n FROM members').get()).toEqual({ n: 1 })
  })
})

describe('.default() is a value, .defaultSql() is SQL', () => {
  const t = table('t', {
    id: serial().primaryKey(),
    word: text().notNull().default('now()'),
    token: text().notNull().defaultSql('lower(hex(randomblob(4)))'),
    both: text().notNull().defaultSql("'a' || 'b'"),
  })

  it('on SQLite: a call-shaped value is stored as written; SQL is evaluated', () => {
    const s = snap({ t })
    const database = new Database(':memory:')
    database.exec(emitSqlite(diff(empty, s), { from: empty, to: s }))
    database.exec('INSERT INTO t DEFAULT VALUES')
    const row = database.prepare('SELECT word, token, both FROM t').get() as Record<string, string>
    expect(row.word).toBe('now()')
    expect(row.token).toMatch(/^[0-9a-f]{8}$/)
    expect(row.both).toBe('ab')
  })

  it('on Postgres and MySQL alike', () => {
    const cols = {
      t: table('t', {
        id: serial().primaryKey(),
        word: text().notNull().default('now()'),
        token: text().notNull().defaultSql('gen_random_uuid()::text'),
      }),
    }
    const pg = emitPg(diff({ ...empty, dialect: 'postgres' }, snap(cols, 'postgres')))
    expect(pg).toContain(`"word" text NOT NULL DEFAULT 'now()'`)
    expect(pg).toContain('"token" text NOT NULL DEFAULT gen_random_uuid()::text')
    const my = emitMysql(diff({ ...empty, dialect: 'mysql' }, snap(cols, 'mysql')))
    expect(my).toContain("`word` TEXT NOT NULL DEFAULT ('now()')")
    expect(my).toContain('`token` TEXT NOT NULL DEFAULT (gen_random_uuid()::text)')
  })

  it('switching between them is a change, and drift compares only the default', async () => {
    const as = (sql: boolean) => ({
      t: table('t', {
        id: serial().primaryKey(),
        n: integer().notNull()[sql ? 'defaultSql' : 'default']('1'),
      }),
    })
    const value = snap(as(false), 'postgres')
    const sql = snap(as(true), 'postgres')
    expect(diff(value, sql).map((c) => c.kind)).toEqual(['alterColumn'])
    // What introspection reads back has no flag: not drift.
    await expect(checkDrift(value, sql, 'error')).resolves.toBeUndefined()
  })
})

it('pairs a column that went from its snake_case name to its key as a rename', () => {
  const a = snap({
    t: table('t', {
      id: serial().primaryKey(),
      project_id: integer().notNull(),
      created_at: text(),
      body: text(),
    }),
  })
  const b = snap({
    t: table('t', {
      id: serial().primaryKey(),
      projectId: integer().notNull(),
      createdAt: text(),
      body: text(),
    }),
  })
  expect(
    diff(a, b).map((c) => (c.kind === 'renameColumn' ? `${c.from}->${c.to}` : c.kind)),
  ).toEqual(['project_id->projectId', 'created_at->createdAt'])
})
