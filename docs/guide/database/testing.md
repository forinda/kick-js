# Testing with kick/db

Three things make database tests pleasant: a database that's fast to create, a clean slate for every test, and a way to hand that database to the code under test. kick/db gives you all three without a test-only API.

## A database per test file

For unit and service tests, an in-memory SQLite database built from your schema is created in milliseconds:

```ts
// test/db.ts
import Database from 'better-sqlite3'
import { createDbClient, diff, emitSqlite, extractSnapshot } from '@forinda/kickjs-db'
import { sqliteDialect } from '@forinda/kickjs-db/sqlite'
import * as schema from '../src/db/schema'

export function createTestDb() {
  const database = new Database(':memory:')
  database.pragma('foreign_keys = ON')

  // CREATE TABLE … for the whole schema, generated the way migrations are.
  const empty = { version: 1 as const, dialect: 'sqlite' as const, tables: {} }
  const target = extractSnapshot(schema, 'sqlite')
  database.exec(emitSqlite(diff(empty, target), { from: empty, to: target }))

  return createDbClient({ schema, dialect: sqliteDialect({ database }) })
}
```

```ts
// src/users/users.service.test.ts
import { afterAll, beforeAll, it, expect } from 'vitest'
import { createTestDb } from '../../test/db'

let db: ReturnType<typeof createTestDb>
beforeAll(() => (db = createTestDb()))
afterAll(() => db.destroy())
```

This works for any schema SQLite can express. Postgres-only column types (`tsvector`, `vector`, enums, …) need a real Postgres — see [below](#against-real-postgres).

If your app runs on SQLite, apply your actual migrations instead, so tests run the same SQL production does:

```ts
import { migrateLatest } from '@forinda/kickjs-db'
import { sqliteAdapter } from '@forinda/kickjs-db/sqlite'

await migrateLatest({
  adapter: sqliteAdapter({ database }),
  migrationsDir: 'db/migrations',
  requireReviewed: false, // migrations must otherwise be reviewed whenever NODE_ENV isn't 'development'
})
```

## Roll back after every test

Run each test inside a transaction that never commits:

```ts
// test/db.ts
const ROLLBACK = Symbol('rollback')

export async function rolledBack(db: { transaction: Function }, fn: () => Promise<void>) {
  await db
    .transaction(async () => {
      await fn()
      throw ROLLBACK
    })
    .catch((err: unknown) => {
      if (err !== ROLLBACK) throw err // a real failure still fails the test
    })
}
```

```ts
it('creates a user', () =>
  rolledBack(db, async () => {
    const user = await service.create('a@b.c')
    expect(user.email).toBe('a@b.c')
  }))
```

Because [transactions follow the call chain](./queries#transactions-follow-the-call-chain), code that only holds the injected client — a service, a repository — runs inside the test's transaction without being handed `tx`, and everything it wrote disappears afterwards. Two things to know:

- `afterCommit` hooks never run in a rolled-back test — assert on what was queued, or test the hook on its own.
- A `transaction({ nested: 'separate' })` inside the code under test commits on its own connection (and isn't possible on SQLite at all).

## Hand the database to your app

`createTestApp` replaces any binding through `overrides`. Swap the token your app registers the client under:

```ts
import { createTestApp } from '@forinda/kickjs-testing'
import request from 'supertest'
import { APP_DB } from '../src/db/token'

const db = createTestDb()
const { app } = await createTestApp({
  modules: [UsersModule()],
  overrides: [[APP_DB, db]],
})

const res = await request(app.handle.bind(app)).get('/api/v1/users')
```

Use the entries form (`[[TOKEN, value]]`) — see [Testing → Overriding a token binding](../testing#overriding-a-token-binding).

## Against real Postgres

Integration tests that need Postgres behaviour — Postgres types, `serializable` conflicts, row-level security — can start a throwaway server with [Testcontainers](https://node.testcontainers.org/):

```ts
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'
import { PostgresDialect } from 'kysely'
import { createDbClient, migrateLatest } from '@forinda/kickjs-db'
import { pgAdapter } from '@forinda/kickjs-db/pg'
import * as schema from '../src/db/schema'

let container: StartedPostgreSqlContainer
let pool: pg.Pool

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  pool = new pg.Pool({ connectionString: container.getConnectionUri() })
  await migrateLatest({
    adapter: pgAdapter({ pool }),
    migrationsDir: 'db/migrations',
    requireReviewed: false,
  })
  db = createDbClient({ schema, dialect: new PostgresDialect({ pool }) })
}, 120_000)

afterAll(async () => {
  await db.destroy() // ends the pool too
  await container.stop()
})
```

Start one container per test file (or once in Vitest's `globalSetup`) and combine it with `rolledBack` so tests don't see each other's rows. Container start-up takes a few seconds; keep these tests to what SQLite can't show.

## Asserting database errors

Failures are [typed errors](./errors), so tests assert the kind, not a driver message:

```ts
import { UniqueViolationError } from '@forinda/kickjs-db'

await expect(service.create('taken@b.c')).rejects.toBeInstanceOf(UniqueViolationError)
await expect(service.create('taken@b.c')).rejects.toMatchObject({ columns: ['email'] })
```

## Related

- [Testing](../testing) — `createTestApp`, modules, environment isolation
- [Queries → Transactions](./queries#transactions)
- [Errors](./errors)
