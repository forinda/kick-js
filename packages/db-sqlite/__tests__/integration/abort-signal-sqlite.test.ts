/**
 * M5.A.2 — `AbortSignal` threading on `db.query.*` against
 * better-sqlite3.
 *
 * better-sqlite3 is synchronous from the JS side — there's no
 * in-flight async operation to interrupt mid-query. The meaningful
 * signal-bound paths are:
 *
 *   1. Already-aborted signal at call time → short-circuit before
 *      compile, no DB round trip.
 *   2. Signal fires between statements (less observable here; PG /
 *      MySQL exercise the in-flight cancel path).
 *
 * Spec: docs/db/spec-abortsignal-threading.md §"Dialect-level
 * cancellation".
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'

import {
  createDbClient,
  RelationalQueryCancelledError,
  relations,
  serial,
  table,
  varchar,
  type KickDbClient,
} from '@forinda/kickjs-db'
import { sqliteDialect } from '../../src'

const users = table('users', {
  id: serial().primaryKey(),
  email: varchar(255).notNull().unique(),
})
const usersRelations = relations(users, () => ({}))
const schema = { users, usersRelations }

interface DB {
  users: { id: number; email: string }
}

declare module '@forinda/kickjs-db' {
  interface KickDbRelationsRegister {
    db: {
      users: Record<string, never>
    }
  }
}

let database: Database.Database
let db: KickDbClient<DB>

function applySql(sql: string): void {
  for (const stmt of sql
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)) {
    database.prepare(stmt).run()
  }
}

beforeAll(() => {
  database = new Database(':memory:')
  applySql(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE
    )
  `)
  db = createDbClient<typeof schema, DB>({
    schema,
    dialect: sqliteDialect({ database }),
  })
})

afterAll(async () => {
  await db?.destroy()
  database?.close()
})

beforeEach(() => {
  applySql(`DELETE FROM users; DELETE FROM sqlite_sequence WHERE name = 'users'`)
})

describe('M5.A.2 — AbortSignal short-circuits SQLite queries before compile', () => {
  it('rejects with RelationalQueryCancelledError when signal is already aborted', async () => {
    database.prepare(`INSERT INTO users (email) VALUES ('a@b.com')`).run()

    const ctrl = new AbortController()
    ctrl.abort('pre-aborted')

    await expect(db.query.users.findMany({ signal: ctrl.signal })).rejects.toBeInstanceOf(
      RelationalQueryCancelledError,
    )

    // Sanity — without the signal, the same call returns the row.
    const result = await db.query.users.findMany()
    expect(result).toHaveLength(1)
  })

  it('threads abort reason onto the cause field', async () => {
    const ctrl = new AbortController()
    const reason = new Error('http client disconnected')
    ctrl.abort(reason)

    try {
      await db.query.users.findMany({ signal: ctrl.signal })
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(RelationalQueryCancelledError)
      expect((err as RelationalQueryCancelledError).cause).toBe(reason)
    }
  })

  it('completes normally when the signal never fires', async () => {
    database.prepare(`INSERT INTO users (email) VALUES ('c@d.com'), ('e@f.com')`).run()
    const ctrl = new AbortController()
    const result = await db.query.users.findMany({ signal: ctrl.signal })
    expect(result.map((r) => r.email).toSorted()).toEqual(['c@d.com', 'e@f.com'])
  })
})
