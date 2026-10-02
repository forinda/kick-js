/**
 * Typed errors from a real Postgres through createDbClient — constraint
 * violations with their columns parsed, and a serialization failure from two
 * concurrent SERIALIZABLE transactions.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'
import { PostgresDialect, type Generated } from 'kysely'
import {
  CheckViolationError,
  ConnectionError,
  ForeignKeyViolationError,
  NotNullViolationError,
  SerializationFailureError,
  UniqueViolationError,
  createDbClient,
  integer,
  serial,
  table,
  varchar,
  type KickDbClient,
} from '@forinda/kickjs-db'

interface DB {
  users: { id: Generated<number>; tenant_id: number; email: string }
  posts: { id: Generated<number>; user_id: number; price: number }
  counters: { id: number; n: number }
}

const schema = {
  users: table('users', { id: serial().primaryKey(), tenant_id: integer(), email: varchar(255) }),
  posts: table('posts', { id: serial().primaryKey(), user_id: integer(), price: integer() }),
  counters: table('counters', { id: integer().primaryKey(), n: integer() }),
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
  pool.on('error', () => {})
  await pool.query(`
    CREATE TABLE users (
      id serial PRIMARY KEY,
      tenant_id int NOT NULL,
      email varchar(255) NOT NULL,
      CONSTRAINT users_tenant_email_key UNIQUE (tenant_id, email)
    );
    CREATE TABLE posts (
      id serial PRIMARY KEY,
      user_id int NOT NULL REFERENCES users(id),
      price int NOT NULL CONSTRAINT price_positive CHECK (price > 0)
    );
    CREATE TABLE counters (id int PRIMARY KEY, n int NOT NULL);
    INSERT INTO counters VALUES (1, 0), (2, 0);
  `)
  db = createDbClient<typeof schema, DB>({ schema, dialect: new PostgresDialect({ pool }) })
}, 120_000)

afterAll(async () => {
  await db?.destroy()
  await container?.stop()
})

describe('typed errors (postgres)', () => {
  it('composite unique violation, with columns from the detail', async () => {
    await db.insertInto('users').values({ tenant_id: 1, email: 'a@b.c' }).execute()
    const err = await db
      .insertInto('users')
      .values({ tenant_id: 1, email: 'a@b.c' })
      .execute()
      .catch((e) => e)
    expect(err).toBeInstanceOf(UniqueViolationError)
    expect(err).toMatchObject({
      constraint: 'users_tenant_email_key',
      table: 'users',
      columns: ['tenant_id', 'email'],
      status: 409,
    })
    expect(err.cause.code).toBe('23505')
  })

  it('foreign key, check and not-null', async () => {
    await expect(
      db.insertInto('posts').values({ user_id: 999, price: 1 }).execute(),
    ).rejects.toBeInstanceOf(ForeignKeyViolationError)
    await expect(
      db.insertInto('posts').values({ user_id: 1, price: 0 }).execute(),
    ).rejects.toMatchObject({ constructor: CheckViolationError, constraint: 'price_positive' })
    await expect(
      db
        .insertInto('users')
        .values({ tenant_id: 1, email: null as unknown as string })
        .execute(),
    ).rejects.toMatchObject({ constructor: NotNullViolationError, columns: ['email'] })
  })

  it('two SERIALIZABLE transactions that write what the other read — one fails, retryable', async () => {
    // Each reads both counters, then writes one: a write skew Postgres
    // refuses under SERIALIZABLE.
    let release!: () => void
    const bothRead = new Promise<void>((r) => (release = r))
    let reads = 0
    const run = (id: number) =>
      db.transaction({ isolation: 'serializable' }, async (tx) => {
        await tx.selectFrom('counters').selectAll().execute()
        if (++reads === 2) release()
        await bothRead
        await tx
          .updateTable('counters')
          .set({ n: 1 })
          .where('id', '=', id === 1 ? 2 : 1)
          .execute()
      })
    const results = await Promise.allSettled([run(1), run(2)])
    const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]
    expect(failed).toHaveLength(1)
    expect(failed[0]!.reason).toBeInstanceOf(SerializationFailureError)
    expect(failed[0]!.reason.retryable).toBe(true)
  })

  it('an unreachable server is a ConnectionError', async () => {
    const dead = createDbClient<typeof schema, DB>({
      schema,
      dialect: new PostgresDialect({
        pool: new pg.Pool({ host: '127.0.0.1', port: 1, connectionTimeoutMillis: 2000 }),
      }),
    })
    await expect(dead.selectFrom('users').selectAll().execute()).rejects.toBeInstanceOf(
      ConnectionError,
    )
    await dead.destroy()
  })
})
