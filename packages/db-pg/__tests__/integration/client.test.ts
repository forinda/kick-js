import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'
import { PostgresDialect, type Generated } from 'kysely'

import { createDbClient, table, serial, varchar, type KickDbClient } from '@forinda/kickjs-db'

interface DB {
  // Generated<T> tells Kysely 'id' is auto-assigned by the DB (serial), so
  // it's optional on insert but always-present on select.
  users: { id: Generated<number>; email: string }
}

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let db: KickDbClient<DB>

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  pool = new pg.Pool({
    host: container.getHost(),
    port: container.getMappedPort(5432),
    user: container.getUsername(),
    password: container.getPassword(),
    database: container.getDatabase(),
  })
  await pool.query(
    `CREATE TABLE "users" ("id" serial PRIMARY KEY, "email" varchar(255) NOT NULL UNIQUE)`,
  )

  const usersDecl = table('users', {
    id: serial().primaryKey(),
    email: varchar(255).notNull().unique(),
  })

  db = createDbClient<{ users: typeof usersDecl }, DB>({
    schema: { users: usersDecl },
    dialect: new PostgresDialect({ pool }),
    events: true,
  })
}, 90_000)

afterAll(async () => {
  // db.destroy() ends the underlying pool via Kysely's PostgresDialect, so we
  // must not call pool.end() again here.
  await db?.destroy()
  await container?.stop()
})

describe('KickDbClient over Kysely (PG)', () => {
  it('round-trips an insert + select', async () => {
    await db.insertInto('users').values({ email: 'a@b.c' }).execute()
    const rows = await db
      .selectFrom('users')
      .select(['id', 'email'])
      .where('email', '=', 'a@b.c')
      .execute()
    expect(rows).toHaveLength(1)
    expect(rows[0].email).toBe('a@b.c')
  }, 30_000)

  it('transaction commits on success', async () => {
    await db.transaction(async (tx) => {
      await tx.insertInto('users').values({ email: 'tx@b.c' }).execute()
    })
    const rows = await db
      .selectFrom('users')
      .select('email')
      .where('email', '=', 'tx@b.c')
      .execute()
    expect(rows).toHaveLength(1)
  }, 30_000)

  it('transaction rolls back on throw', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.insertInto('users').values({ email: 'rb@b.c' }).execute()
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    const rows = await db
      .selectFrom('users')
      .select('email')
      .where('email', '=', 'rb@b.c')
      .execute()
    expect(rows).toHaveLength(0)
  }, 30_000)

  it('transactionStart/Commit events fire in order', async () => {
    const seen: string[] = []
    // Explicit block so the listeners return void, not the array length push() yields.
    const onStart = () => {
      seen.push('start')
    }
    const onCommit = () => {
      seen.push('commit')
    }
    db.on('transactionStart', onStart)
    db.on('transactionCommit', onCommit)
    try {
      await db.transaction(async () => {})
      expect(seen).toEqual(['start', 'commit'])
    } finally {
      db.off('transactionStart', onStart)
      db.off('transactionCommit', onCommit)
    }
  }, 30_000)

  it('transactionRollback fires with the error payload', async () => {
    const onRb = vi.fn()
    db.on('transactionRollback', onRb)
    try {
      await expect(
        db.transaction(async () => {
          throw new Error('rb-event')
        }),
      ).rejects.toThrow('rb-event')
      expect(onRb).toHaveBeenCalledTimes(1)
      const payload = onRb.mock.calls[0][0]
      expect(payload.error).toBeInstanceOf(Error)
    } finally {
      db.off('transactionRollback', onRb)
    }
  }, 30_000)
})
