/**
 * End-to-end coverage for the relational-query namespace exposed
 * via `createDbClient(...).query.X`. Uses Kysely's `DummyDriver` so
 * the test never opens a connection — `findMany` / `findFirst` /
 * `findUnique` go through `executeQuery`, which we intercept to
 * return canned rows.
 *
 * Confirms that:
 *   1. `createDbClient` extracts relations + picks the right
 *      compiler from the dialect tag.
 *   2. The Proxy-based namespace materializes per-table
 *      sub-namespaces on first access.
 *   3. `findFirst` / `findUnique` clamp to a single row and `null`
 *      on empty result.
 *   4. SQLite emits dialect-specific SQL (json_group_array, not
 *      json_agg) — confirms the dialect picker selected the
 *      SQLite compiler.
 *   5. MySQL still throws `RelationalQueryNotSupportedError` on
 *      first `findMany` call until M4.A.3 ships the compiler.
 *
 * Note: by stubbing `executeQuery`, these tests do NOT exercise
 * the `ParseJSONResultsPlugin` chain that `createDbClient`
 * auto-attaches for SQLite. End-to-end JSON-string-to-object
 * round-trip lands in `packages/db-sqlite/__tests__/integration/`
 * (M4.A.5), where a real `better-sqlite3` driver returns the
 * actual JSON-encoded TEXT for the plugin to parse.
 */

import { describe, expect, it, vi } from 'vitest'
import {
  DummyDriver,
  Kysely,
  MysqlAdapter,
  MysqlIntrospector,
  MysqlQueryCompiler,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  type Dialect as KyselyDialect,
} from 'kysely'
import {
  createDbClient,
  RelationalQueryNotSupportedError,
  relations,
  serial,
  table,
  uuid,
  varchar,
} from '../../src/index'

const users = table('users', {
  id: uuid().primaryKey().defaultRandom(),
  email: varchar(255).notNull().unique(),
})

const posts = table('posts', {
  id: serial().primaryKey(),
  authorId: uuid()
    .notNull()
    .references(() => users.id),
  title: varchar(255).notNull(),
})

const usersRelations = relations(users, (h) => ({ posts: h.many(posts) }))
const postsRelations = relations(posts, (h) => ({
  author: h.one(users, { fields: [posts.authorId], references: [users.id] }),
}))

const schema = { users, posts, usersRelations, postsRelations }

function makePgDialect(): KyselyDialect {
  return {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (db: Kysely<unknown>) => new PostgresIntrospector(db),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  }
}

function makeSqliteDialect(): KyselyDialect {
  return {
    createAdapter: () => new SqliteAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (db: Kysely<unknown>) => new SqliteIntrospector(db),
    createQueryCompiler: () => new SqliteQueryCompiler(),
  }
}

function makeMysqlDialect(): KyselyDialect {
  return {
    createAdapter: () => new MysqlAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (db: Kysely<unknown>) => new MysqlIntrospector(db),
    createQueryCompiler: () => new MysqlQueryCompiler(),
  }
}

/**
 * Patch `executeQuery` on the underlying Kysely so we can capture
 * the SQL the namespace emits and feed back canned rows.
 */
function patchExecute(client: { qb: Kysely<unknown> }, rows: unknown[]) {
  const calls: { sql: string; parameters: readonly unknown[] }[] = []
  const original = (client.qb as unknown as { executeQuery: unknown }).executeQuery
  ;(
    client.qb as unknown as {
      executeQuery: (q: {
        sql: string
        parameters: readonly unknown[]
      }) => Promise<{ rows: unknown[] }>
    }
  ).executeQuery = vi.fn(async (compiled) => {
    calls.push({ sql: compiled.sql, parameters: compiled.parameters })
    return { rows }
  })
  return {
    calls,
    restore: () => {
      ;(client.qb as unknown as { executeQuery: unknown }).executeQuery = original
    },
  }
}

describe('createDbClient → db.query namespace (PG)', () => {
  it('findMany compiles and executes a plain selectAll on the table', async () => {
    const db = createDbClient({ schema, dialect: makePgDialect() })
    const { calls } = patchExecute(db, [{ id: '1', email: 'a@b.com' }])
    const result = await db.query.users.findMany()
    expect(result).toEqual([{ id: '1', email: 'a@b.com' }])
    // Outer alias `users_0` — see compile-pg makeAlias().
    expect(calls[0]?.sql).toBe('select * from "users" as "users_0"')
    expect(calls[0]?.parameters).toEqual([])
  })

  it('findMany with `with` emits json_agg + correlated whereRef', async () => {
    const db = createDbClient({ schema, dialect: makePgDialect() })
    const { calls } = patchExecute(db, [])
    await db.query.users.findMany({ with: { posts: true } })
    expect(calls[0]?.sql).toContain('json_agg')
    expect(calls[0]?.sql).toContain('"posts_1"."authorId" = "users_0"."id"')
  })

  it('findFirst clamps to LIMIT 1 and returns the first row', async () => {
    const db = createDbClient({ schema, dialect: makePgDialect() })
    const { calls } = patchExecute(db, [
      { id: '1', email: 'a@b.com' },
      { id: '2', email: 'b@b.com' },
    ])
    const result = await db.query.users.findFirst()
    expect(result).toEqual({ id: '1', email: 'a@b.com' })
    expect(calls[0]?.sql).toContain('limit $1')
    expect(calls[0]?.parameters).toEqual([1])
  })

  it('findFirst returns null on empty result', async () => {
    const db = createDbClient({ schema, dialect: makePgDialect() })
    patchExecute(db, [])
    const result = await db.query.users.findFirst()
    expect(result).toBeNull()
  })

  it('findUnique clamps to LIMIT 1 and returns the row', async () => {
    const db = createDbClient({ schema, dialect: makePgDialect() })
    const { calls } = patchExecute(db, [{ id: '1', email: 'a@b.com' }])
    const result = await db.query.users.findUnique({
      where: (u, eb) => eb('email', '=', 'a@b.com'),
    })
    expect(result).toEqual({ id: '1', email: 'a@b.com' })
    expect(calls[0]?.parameters).toContain('a@b.com')
    expect(calls[0]?.sql).toContain('limit')
  })

  it('Proxy namespace materializes a fresh table-namespace per access', () => {
    const db = createDbClient({ schema, dialect: makePgDialect() })
    expect(typeof db.query.users.findMany).toBe('function')
    expect(typeof db.query.posts.findFirst).toBe('function')
  })
})

describe('createDbClient → db.query namespace (SQLite — M4.A.2)', () => {
  it('SQLite findMany compiles via kysely/helpers/sqlite', async () => {
    const db = createDbClient({ schema, dialect: makeSqliteDialect() })
    const { calls } = patchExecute(db, [{ id: '1', email: 'a@b.com' }])
    const result = await db.query.users.findMany({ with: { posts: true } })
    expect(result).toEqual([{ id: '1', email: 'a@b.com' }])
    // SQLite uses json_group_array + json_object — different
    // primitives than PG's json_agg + row_to_json. Confirms the
    // dialect picker selected the SQLite compiler.
    expect(calls[0]?.sql).toContain('json_group_array')
    expect(calls[0]?.sql).toContain('json_object')
    expect(calls[0]?.sql).not.toContain('json_agg')
  })

  it('SQLite findFirst clamps via LIMIT 1', async () => {
    const db = createDbClient({ schema, dialect: makeSqliteDialect() })
    const { calls } = patchExecute(db, [])
    await db.query.users.findFirst()
    expect(calls[0]?.sql).toContain('limit ?')
  })
})

describe('createDbClient → db.query namespace (unsupported dialects)', () => {
  it('MySQL throws RelationalQueryNotSupportedError on findMany', async () => {
    const db = createDbClient({ schema, dialect: makeMysqlDialect() })
    await expect(db.query.users.findMany()).rejects.toThrow(RelationalQueryNotSupportedError)
  })
})
