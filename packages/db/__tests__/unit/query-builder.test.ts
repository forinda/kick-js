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
 *   4. SQLite/MySQL clients throw `RelationalQueryNotSupportedError`
 *      on first `findMany` call.
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
    expect(calls[0]?.sql).toBe('select * from "users"')
    expect(calls[0]?.parameters).toEqual([])
  })

  it('findMany with `with` emits json_agg + correlated whereRef', async () => {
    const db = createDbClient({ schema, dialect: makePgDialect() })
    const { calls } = patchExecute(db, [])
    await db.query.users.findMany({ with: { posts: true } })
    expect(calls[0]?.sql).toContain('json_agg')
    expect(calls[0]?.sql).toContain('"posts"."authorId" = "users"."id"')
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

describe('createDbClient → db.query namespace (unsupported dialects)', () => {
  it('SQLite throws RelationalQueryNotSupportedError on findMany', async () => {
    const db = createDbClient({ schema, dialect: makeSqliteDialect() })
    await expect(db.query.users.findMany()).rejects.toThrow(RelationalQueryNotSupportedError)
  })

  it('MySQL throws RelationalQueryNotSupportedError on findMany', async () => {
    const db = createDbClient({ schema, dialect: makeMysqlDialect() })
    await expect(db.query.users.findMany()).rejects.toThrow(RelationalQueryNotSupportedError)
  })
})
