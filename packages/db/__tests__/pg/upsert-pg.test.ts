/**
 * `db.upsert()` and `db.findOrCreate()` on Postgres — including the race
 * findOrCreate exists for: concurrent callers get one row, created once.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'
import { sql } from 'kysely'
import {
  boolean,
  createDbClient,
  diff,
  emitPg,
  extractSnapshot,
  serial,
  table,
  text,
  varchar,
} from '@forinda/kickjs-db'
import { pgDialect } from '@forinda/kickjs-db/pg'

const users = table('users', {
  id: serial().primaryKey(),
  email: varchar(255).notNull().unique(),
  name: text().notNull(),
})
const handles = table('handles', {
  id: serial().primaryKey(),
  handle: text().notNull(),
  active: boolean().notNull(),
  owner: text().notNull(),
})
const schema = { users, handles }

let container: StartedPostgreSqlContainer
let pool: pg.Pool

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  pool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 10 })
  pool.on('error', () => {})
  const empty = { version: 1 as const, dialect: 'postgres' as const, tables: {} }
  await pool.query(emitPg(diff(empty, extractSnapshot(schema, 'postgres'))))
  await pool.query('CREATE UNIQUE INDEX handles_active ON handles (handle) WHERE active')
}, 120_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
}, 60_000)

beforeEach(async () => {
  await pool.query('TRUNCATE users, handles RESTART IDENTITY')
})

const db = () => createDbClient({ schema, dialect: pgDialect({ pool }) })

describe('upsert on Postgres', () => {
  it('inserts, updates, and takes many rows', async () => {
    const client = db()
    await client.upsert('users', { values: { email: 'a@x.com', name: 'Ada' }, target: ['email'] })
    const rows = await client.upsert('users', {
      values: [
        { email: 'a@x.com', name: 'Ada 2' },
        { email: 'b@x.com', name: 'Bob' },
      ],
      target: ['email'],
    })
    expect(rows.map((r) => [r.id, r.name])).toEqual([
      [1, 'Ada 2'],
      [3, 'Bob'],
    ])
  }, 30_000)

  it('targets a partial unique index', async () => {
    const client = db()
    const where = () => sql<boolean>`active`
    await client.upsert('handles', {
      values: { handle: 'ada', active: true, owner: 'one' },
      target: ['handle'],
      where,
    })
    const again = await client.upsert('handles', {
      values: { handle: 'ada', active: true, owner: 'two' },
      target: ['handle'],
      where,
    })
    expect(again).toMatchObject({ id: 1, owner: 'two' })
  }, 30_000)
})

describe('findOrCreate on Postgres', () => {
  it('is race-safe: concurrent callers share one row, created once', async () => {
    const client = db()
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        client.findOrCreate('users', { where: { email: 'race@x.com' }, create: { name: 'R' } }),
      ),
    )
    expect(new Set(results.map((r) => r.row.id)).size).toBe(1)
    expect(results.filter((r) => r.created)).toHaveLength(1)
  }, 30_000)

  it('a failed create inside a transaction leaves the transaction usable', async () => {
    const client = db()
    await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS users_email_ci ON users (lower(email))')
    await client.insertInto('users').values({ email: 'taken@x.com', name: 'First' }).execute()
    await client.transaction(async () => {
      // The exact-match find misses 'TAKEN@x.com'; the insert collides on lower(email).
      await expect(
        client.findOrCreate('users', {
          where: { email: 'TAKEN@x.com' },
          create: { name: 'Second' },
        }),
      ).rejects.toThrow(/unique|duplicate/i)
      // Postgres aborts a transaction on a failed statement — unless it ran in a savepoint.
      await client.insertInto('users').values({ email: 'after@x.com', name: 'After' }).execute()
    })
    expect(await client.selectFrom('users').select('email').orderBy('id').execute()).toEqual([
      { email: 'taken@x.com' },
      { email: 'after@x.com' },
    ])
    await pool.query('DROP INDEX users_email_ci')
  }, 30_000)
})
