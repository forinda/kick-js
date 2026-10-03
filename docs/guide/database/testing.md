# Testing with kick/db

Three things make database tests pleasant: a database that's fast to create, a clean slate for every test, and a way to hand that database to the code under test. `@forinda/kickjs-db/testing` gives you all three.

## A database per test file

For unit and service tests, `createTestDb` builds an in-memory SQLite database from your schema in milliseconds, with foreign keys enforced:

```ts
// src/users/users.service.test.ts
import { afterAll, beforeAll, it, expect } from 'vitest'
import { createTestDb } from '@forinda/kickjs-db/testing'
import * as schema from '../db/schema'

let db: Awaited<ReturnType<typeof createTestDb<typeof schema>>>
beforeAll(async () => (db = await createTestDb({ schema })))
afterAll(() => db.destroy())
```

Each call is a separate database, so test files never see each other's rows. It needs `better-sqlite3` installed. This works for any schema SQLite can express; Postgres-only column types (`tsvector`, `vector`, enums, …) need a real Postgres — see [below](#against-real-postgres).

If your app runs on SQLite, apply your actual migrations instead, so tests run the same SQL production does:

```ts
db = await createTestDb({ schema, migrationsDir: 'db/migrations' })
```

Unreviewed migrations apply here — tests aren't deploys.

## Roll back after every test

`rolledBack` runs a test inside a transaction that never commits:

```ts
import { rolledBack } from '@forinda/kickjs-db/testing'

it('creates a user', () =>
  rolledBack(db, async () => {
    const user = await service.create('a@b.c')
    expect(user.email).toBe('a@b.c')
  }))
```

Because [transactions follow the call chain](./transactions#transactions-follow-the-call-chain), code that only holds the injected client — a service, a repository — runs inside the test's transaction without being handed `tx`, and everything it wrote disappears afterwards. A failing assertion still fails the test. Two things to know:

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

Use the entries form (`[[TOKEN, value]]`) — see [Replace a dependency](../testing/http.md#replace-a-dependency-overrides).

## Against real Postgres

Integration tests that need Postgres behaviour — Postgres types, `serializable` conflicts, row-level security — need a Postgres server: a CI service container, a local Docker Postgres, or [Testcontainers](https://node.testcontainers.org/). Point `createPgTestDb` at it and each test file gets its own throwaway database on that server, with your schema or migrations applied — well under a second, no container per file:

```ts
import { afterAll, beforeAll } from 'vitest'
import { createPgTestDb, type PgTestDb } from '@forinda/kickjs-db/testing'
import * as schema from '../src/db/schema'

let pg: PgTestDb<typeof schema>

beforeAll(async () => {
  pg = await createPgTestDb({
    schema, // or migrationsDir: 'db/migrations'
    connectionString: process.env.TEST_DATABASE_URL!, // a database you may CREATE DATABASE from
  })
})
afterAll(() => pg.drop()) // closes the client and drops the database

it('…', () =>
  rolledBack(pg.db, async () => {
    /* … */
  }))
```

`pg.connectionString` points at the throwaway database, for code that opens its own pool. It needs `pg` installed. In GitHub Actions, a `services: postgres:` entry gives you the server — see [CI and Deployment](./ci-deploy.md).

## Asserting database errors

Failures are [typed errors](./errors), so tests assert the kind, not a driver message:

```ts
import { UniqueViolationError } from '@forinda/kickjs-db'

await expect(service.create('taken@b.c')).rejects.toBeInstanceOf(UniqueViolationError)
await expect(service.create('taken@b.c')).rejects.toMatchObject({ columns: ['email'] })
```

## Related

- [Testing](../testing) — `createTestApp`, modules, environment isolation
- [Queries → Transactions](./transactions)
- [Errors](./errors)
