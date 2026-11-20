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

Each call is a separate database, so test files never see each other's rows. It needs `better-sqlite3` installed. This works for any schema SQLite can express; Postgres-only column types (`tsvector`, `vector`, enums, …) need a real Postgres — see [below](#against-a-real-server).

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
import { APP_DB } from '@/db/token'

const db = createTestDb()
const { app } = await createTestApp({
  modules: [UsersModule()],
  overrides: [[APP_DB, db]],
})

const res = await request(app.handle.bind(app)).get('/api/v1/users')
```

Use the entries form (`[[TOKEN, value]]`) — see [Replace a dependency](../testing/http.md#replace-a-dependency-overrides).

## Against a real server

Integration tests that need Postgres or MySQL behaviour (Postgres types, `serializable` conflicts, row-level security) need a real server. The fastest setup is one shared container for the whole run, with a throwaway database per test file on it:

```ts
// tests/global-setup.ts — one Postgres for the run, reused by the next local run
import { kickTestServices } from '@forinda/kickjs-testing/vitest'

export default kickTestServices({ postgres: { name: 'myapp-test-pg' } })
```

```ts
// any test file
import { useTestDb } from '@forinda/kickjs-db/testing/vitest'

const t = useTestDb({ migrationsDir: 'db/migrations' }) // or { schema }

it('…', () =>
  rolledBack(t.db, async () => {
    /* … */
  }))
```

`useTestDb` creates the file's database before its tests and drops it after. It finds the server through `kickTestServices` (`inject('postgres')`), or `KICK_TEST_POSTGRES_URL`. With no server it uses in-memory SQLite. See [Large Suites](../testing/large-suites.md#reused-containers) for the services side.

- **Migrations run once.** The first file migrates a template database (`kick_tpl_<hash of your migrations>`). Every file's database is a copy of it, so creating one stays well under a second however many migrations you have. A change to the migrations makes a new template.
- **Empty databases.** With neither `migrationsDir` nor `schema`, the file gets an empty database, for tests that run migrations or `push` themselves.
- **MySQL** works the same way: `dialect: 'mysql'`, or `createMysqlTestDb`, with `KICK_TEST_MYSQL_URL` / `inject('mysql')`. MySQL has no template databases, so each copy re-creates the template's tables, rows and foreign keys. A template with views, triggers or routines is migrated per file instead.
- **Only test servers.** The helpers refuse a server URL whose database name doesn't contain `test`, so they can't create databases next to your development data. Pass `allowNonTestDatabase: true` to override.
- **The first file builds the template.** The other files wait for it, up to `lockWaitSeconds` (default 120). Keep Vitest's `hookTimeout` above how long your migrations take: `test: { hookTimeout: 60_000 }`. A build that's interrupted (Ctrl-C, a timed-out hook) is detected and rebuilt by the next run.
- **Leftovers clean themselves up.** A crashed run's databases are dropped by a later run: `kick_test_*` after 6 hours, templates after 24. A database still in use is left alone.

Without Vitest, or to manage the lifecycle yourself, use the functions underneath:

```ts
import { createPgTestDb, type PgTestDb } from '@forinda/kickjs-db/testing'

let pg: PgTestDb<typeof schema>
beforeAll(async () => {
  pg = await createPgTestDb({ migrationsDir: 'db/migrations' }) // connectionString defaults to KICK_TEST_POSTGRES_URL
})
afterAll(() => pg.drop()) // closes the client and drops the database
```

`pg.connectionString` points at the throwaway database, for code that opens its own pool. You need `pg` installed (or `mysql2` for MySQL). In GitHub Actions, a `services: postgres:` entry gives you the server; see [CI and Deployment](./ci-deploy.md).

## Asserting database errors

Failures are [typed errors](./errors), so tests assert the kind, not a driver message:

```ts
import { UniqueViolationError } from '@forinda/kickjs-db'

await expect(service.create('taken@b.c')).rejects.toBeInstanceOf(UniqueViolationError)
await expect(service.create('taken@b.c')).rejects.toMatchObject({ columns: ['email'] })
```

## Counting queries

A list endpoint that runs one query per row (an N+1) passes every test with three rows and falls over with three thousand. Pin the count instead:

```ts
import { expectQueries } from '@forinda/kickjs-db/testing'

it('loads posts with their authors in two queries', async () => {
  const posts = await expectQueries(db, 2, () => service.postsWithAuthors())
  expect(posts).toHaveLength(3)
})
```

On a mismatch the error lists every query that ran, numbered, so the extra one is easy to spot. `captureQueries(db, fn)` returns `{ result, queries }` when you want to assert on the SQL yourself.

Both need a client with events on. `createTestDb` and `createPgTestDb` turn them on; for a client of your own, pass `createDbClient({ events: true })`. A client without events is refused rather than counted as zero.

## Related

- [Testing](../testing) — `createTestApp`, modules, environment isolation
- [Queries → Transactions](./transactions)
- [Errors](./errors)
