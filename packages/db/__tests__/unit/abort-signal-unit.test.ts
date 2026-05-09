/**
 * M5.A.2 — `AbortSignal` threading on `db.query.*`.
 *
 * Stubs `executeQuery` to observe the second-arg `{ signal }`
 * passthrough Kysely 0.29 expects. Real-driver cancellation lives
 * in the dialect-specific peer integration tests (db-pg / db-sqlite
 * / db-mysql).
 *
 * Spec: docs/db/spec-abortsignal-threading.md.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, expect, it, vi } from 'vitest'
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type Dialect as KyselyDialect,
} from 'kysely'

import {
  createDbClient,
  relations,
  serial,
  table,
  uuid,
  varchar,
  RelationalQueryCancelledError,
} from '@forinda/kickjs-db'

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

interface ExecuteCall {
  sql: string
  signal: AbortSignal | undefined
}

function patchExecuteToObserve(client: { qb: Kysely<unknown> }) {
  const calls: ExecuteCall[] = []
  const original = (client.qb as any).executeQuery
  ;(client.qb as any).executeQuery = vi.fn(async (compiled: any, opts?: any) => {
    calls.push({ sql: compiled.sql, signal: opts?.signal })
    return { rows: [] }
  })
  return {
    calls,
    restore: () => {
      ;(client.qb as any).executeQuery = original
    },
  }
}

function patchExecuteToReject(client: { qb: Kysely<unknown> }, err: unknown) {
  const original = (client.qb as any).executeQuery
  ;(client.qb as any).executeQuery = vi.fn(async () => {
    throw err
  })
  return () => {
    ;(client.qb as any).executeQuery = original
  }
}

describe('M5.A.2 — signal passthrough on findMany / findFirst / findUnique', () => {
  it('forwards the signal to executeQuery on findMany', async () => {
    const db = createDbClient({ schema, dialect: makePgDialect() })
    const { calls, restore } = patchExecuteToObserve(db)
    const ctrl = new AbortController()
    try {
      await db.query.users.findMany({ signal: ctrl.signal })
    } finally {
      restore()
    }
    expect(calls).toHaveLength(1)
    expect(calls[0]!.signal).toBe(ctrl.signal)
  })

  it('forwards the signal on findFirst', async () => {
    const db = createDbClient({ schema, dialect: makePgDialect() })
    const { calls, restore } = patchExecuteToObserve(db)
    const ctrl = new AbortController()
    try {
      await db.query.users.findFirst({ signal: ctrl.signal })
    } finally {
      restore()
    }
    expect(calls[0]!.signal).toBe(ctrl.signal)
  })

  it('forwards the signal on findUnique', async () => {
    const db = createDbClient({ schema, dialect: makePgDialect() })
    const { calls, restore } = patchExecuteToObserve(db)
    const ctrl = new AbortController()
    try {
      await db.query.users.findUnique({
        where: (_u: unknown, eb: any) => eb('id', '=', 'abc'),
        signal: ctrl.signal,
      })
    } finally {
      restore()
    }
    expect(calls[0]!.signal).toBe(ctrl.signal)
  })

  it('omits the signal field when the caller did not pass one', async () => {
    const db = createDbClient({ schema, dialect: makePgDialect() })
    const { calls, restore } = patchExecuteToObserve(db)
    try {
      await db.query.users.findMany()
    } finally {
      restore()
    }
    expect(calls[0]!.signal).toBeUndefined()
  })
})

describe('M5.A.2 — already-aborted signal short-circuits before compile', () => {
  it('rejects with RelationalQueryCancelledError when signal.aborted is true', async () => {
    const db = createDbClient({ schema, dialect: makePgDialect() })
    const { calls, restore } = patchExecuteToObserve(db)
    const ctrl = new AbortController()
    ctrl.abort('test cancellation')
    try {
      await expect(db.query.users.findMany({ signal: ctrl.signal })).rejects.toBeInstanceOf(
        RelationalQueryCancelledError,
      )
    } finally {
      restore()
    }
    // No SQL was generated — short-circuit beat the compile call.
    expect(calls).toHaveLength(0)
  })

  it('threads the abort reason onto the error.cause field', async () => {
    const db = createDbClient({ schema, dialect: makePgDialect() })
    const { restore } = patchExecuteToObserve(db)
    const reason = new Error('http timeout fired')
    const ctrl = new AbortController()
    ctrl.abort(reason)
    try {
      await db.query.users.findMany({ signal: ctrl.signal })
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(RelationalQueryCancelledError)
      expect((err as RelationalQueryCancelledError).cause).toBe(reason)
    } finally {
      restore()
    }
  })
})

describe('M5.A.2 — error mapping on rejection from executeQuery', () => {
  it('maps a DOM-style AbortError to RelationalQueryCancelledError', async () => {
    const db = createDbClient({ schema, dialect: makePgDialect() })
    const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' })
    const restore = patchExecuteToReject(db, abortError)
    try {
      await expect(db.query.users.findMany()).rejects.toBeInstanceOf(RelationalQueryCancelledError)
    } finally {
      restore()
    }
  })

  it('maps PG SQLSTATE 57014 (query_canceled) to RelationalQueryCancelledError', async () => {
    const db = createDbClient({ schema, dialect: makePgDialect() })
    const pgError = Object.assign(new Error('query was cancelled'), { code: '57014' })
    const restore = patchExecuteToReject(db, pgError)
    try {
      await expect(db.query.users.findMany()).rejects.toBeInstanceOf(RelationalQueryCancelledError)
    } finally {
      restore()
    }
  })

  it('maps better-sqlite3 SQLITE_INTERRUPT to RelationalQueryCancelledError', async () => {
    const db = createDbClient({ schema, dialect: makePgDialect() })
    const sqliteError = Object.assign(new Error('interrupted'), { code: 'SQLITE_INTERRUPT' })
    const restore = patchExecuteToReject(db, sqliteError)
    try {
      await expect(db.query.users.findMany()).rejects.toBeInstanceOf(RelationalQueryCancelledError)
    } finally {
      restore()
    }
  })

  it('maps mysql2 EAGAIN_QUERY_INTERRUPTED to RelationalQueryCancelledError', async () => {
    const db = createDbClient({ schema, dialect: makePgDialect() })
    const mysqlError = Object.assign(new Error('interrupted'), { code: 'EAGAIN_QUERY_INTERRUPTED' })
    const restore = patchExecuteToReject(db, mysqlError)
    try {
      await expect(db.query.users.findMany()).rejects.toBeInstanceOf(RelationalQueryCancelledError)
    } finally {
      restore()
    }
  })

  it('passes unrelated rejections through verbatim', async () => {
    const db = createDbClient({ schema, dialect: makePgDialect() })
    const typeError = new TypeError('something else broke')
    const restore = patchExecuteToReject(db, typeError)
    try {
      await expect(db.query.users.findMany()).rejects.toBe(typeError)
    } finally {
      restore()
    }
  })
})
