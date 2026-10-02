/**
 * The recipes on the "Testing with kick/db" docs page, run as written: an
 * in-memory SQLite database built from the schema, and a transaction per
 * test that rolls back — including for code that only holds the plain client.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  UniqueViolationError,
  createDbClient,
  diff,
  emitSqlite,
  extractSnapshot,
  serial,
  table,
  varchar,
  type KickDbClient,
} from '@forinda/kickjs-db'
import { sqliteDialect } from '@forinda/kickjs-db/sqlite'

// ── the app's schema (src/db/schema.ts) ──
const users = table('users', {
  id: serial().primaryKey(),
  email: varchar(255).notNull().unique(),
})
const schema = { users }

// ── test/db.ts, as on the docs page ──
function createTestDb() {
  const database = new Database(':memory:')
  database.pragma('foreign_keys = ON')
  const empty = { version: 1 as const, dialect: 'sqlite' as const, tables: {} }
  const target = extractSnapshot(schema, 'sqlite')
  database.exec(emitSqlite(diff(empty, target), { from: empty, to: target }))
  return createDbClient({ schema, dialect: sqliteDialect({ database }) })
}

const ROLLBACK = Symbol('rollback')
async function rolledBack(
  db: { transaction: KickDbClient['transaction'] },
  fn: () => Promise<void>,
) {
  await db
    .transaction(async () => {
      await fn()
      throw ROLLBACK
    })
    .catch((err) => {
      if (err !== ROLLBACK) throw err
    })
}

// ── a service that only holds the plain client ──
class UsersService {
  constructor(private readonly db: ReturnType<typeof createTestDb>) {}
  create(email: string) {
    return this.db.insertInto('users').values({ email }).returningAll().executeTakeFirstOrThrow()
  }
  count() {
    return this.db
      .selectFrom('users')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .executeTakeFirstOrThrow()
  }
}

let db: ReturnType<typeof createTestDb>
let users$: UsersService
beforeAll(() => {
  db = createTestDb()
  users$ = new UsersService(db)
})
afterAll(() => db.destroy())

describe('testing recipes', () => {
  it('builds the schema in memory', async () => {
    expect((await users$.create('a@x.io')).email).toBe('a@x.io')
  })

  it('rolls a test back — the service joins the test transaction', async () => {
    const before = (await users$.count()).n
    let sentHooks = 0
    await rolledBack(db, async () => {
      await users$.create('temp@x.io')
      await db.afterCommit(() => void sentHooks++)
      expect((await users$.count()).n).toBe(before + 1)
    })
    expect((await users$.count()).n).toBe(before)
    expect(sentHooks).toBe(0) // afterCommit hooks never run in a rolled-back test
  })

  it('asserts typed errors', async () => {
    await expect(users$.create('a@x.io')).rejects.toBeInstanceOf(UniqueViolationError)
  })

  it('lets a real failure through the rollback helper', async () => {
    await expect(
      rolledBack(db, async () => {
        throw new Error('assertion failed')
      }),
    ).rejects.toThrow('assertion failed')
  })
})
