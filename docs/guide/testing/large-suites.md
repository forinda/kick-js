---
description: Running a large KickJS test suite fast and reliably — sharing one app per worker, resetting state, database strategies, guarding against the wrong database, containers in CI and keeping tests independent.
---

# Large Suites

A few dozen test files run fine with the defaults. At hundreds, three things start to matter: how often the app is built, what state leaks between files, and which database the tests touch.

## One app per worker

Building the app (registering modules, running adapter hooks, connecting pools) takes from tens of milliseconds to seconds. Done once per file, that's most of a large suite's run time. With Vitest's `isolate: false`, module state survives between files in a worker, so one app can serve them all:

```ts
// vitest.config.ts
export default defineConfig({
  test: {
    isolate: false, // keep module state between files in a worker
    fileParallelism: false, // one worker, if the tests share one database
  },
})
```

```ts
// every test file
const t = useTestApp(() => appOptions, { shared: true, client: { basePath: '/api/v1' } })
```

With `shared: true`, the first file in a worker builds the app and the rest reuse it. It shuts down when the worker exits. The options function runs only for the first file, so a later file's `overrides` don't take effect. Put shared fakes in `appOptions`. Files that need differently wired apps give each wiring a name, and get one app per name:

```ts
const t = useTestApp(() => adminOptions, { shared: 'admin-api' })
```

## Reset state, not the app: `onTestReset`

The cost of sharing is that state outlives a file: an in-memory fake's records, a cache, a counter in a module. Register the reset next to the state, once:

```ts
// tests/fakes/sms.ts
export const sentSms: Sms[] = []
onTestReset(() => {
  sentSms.length = 0
})

// src/entitlements/cache.ts (test-only reset of a production cache)
if (process.env.NODE_ENV === 'test') onTestReset(() => entitlementCache.clear())
```

`useTestApp` runs every registered reset before each file (`reset: 'file'`, the default), or before each test with `reset: 'test'`. Outside `useTestApp`, call `resetTestState()`. Resets run in the order they were registered, and all of them run even if one throws.

This replaces the `resetX()` call at the top of every file. It's also how you find state you didn't know was shared: a test that passes alone and fails in the suite usually leans on one.

## The database

Pick one strategy per suite. They trade speed for how faithfully they match production:

| Strategy                                     | Speed   | Notes                                                                                                   |
| -------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------- |
| a transaction per test, rolled back          | fastest | the code under test must use the test's transaction; see [Testing with kick/db](../database/testing.md) |
| a database per worker, emptied between files | fast    | truncate the tables your tests write; keep seeded reference rows                                        |
| a database per file                          | slower  | `createPgTestDb()` creates and drops one on an existing server                                          |
| in-memory SQLite per file                    | fastest | only when production runs SQLite, or for logic that doesn't depend on the dialect                       |

With kick/db, `@forinda/kickjs-db/testing` has `createTestDb`, `createPgTestDb` and `rolledBack` for these. With another database library, the same strategies apply. For example, emptying the tables in one statement:

```ts
// tests/helpers/db.ts
const KEEP = new Set(['kick_migrations', 'kick_migrations_lock', 'roles', 'permissions'])

export async function emptyTables(sql: SqlClient) {
  const rows = await sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`
  const tables = rows.map((r) => `"${r.tablename}"`).filter((t) => !KEEP.has(t.slice(1, -1)))
  if (tables.length) await sql.unsafe(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`)
}

onTestReset(() => emptyTables(harnessSql))
```

Reading the table list from the catalog, rather than keeping a list in foreign-key order, means a new table can't be forgotten.

## Refuse the wrong database

A test suite that empties tables must never reach a database that matters. Check before anything connects:

```ts
// tests/global-setup.ts
export default function setup() {
  const url = new URL(process.env.DATABASE_URL ?? '')
  if (!/test/.test(url.pathname)) {
    throw new Error(
      `Refusing to run tests against "${url.pathname.slice(1)}": its name must contain "test"`,
    )
  }
}
```

Give the test database its own credentials too, so a missed override fails at login instead of silently using your development database.

## Containers in CI

Start real services (Postgres, Redis, a message broker) once per run in Vitest's `globalSetup`, and pass their addresses through `process.env` before any test file imports the app:

```ts
// tests/global-setup.ts
import { PostgreSqlContainer } from '@testcontainers/postgresql'

export default async function setup() {
  const pg = await new PostgreSqlContainer('postgres:17-alpine').withDatabase('app_test').start()
  process.env.DATABASE_URL = pg.getConnectionUri()
  // migrate once, here — not per file
  return async () => pg.stop()
}
```

Values set here reach the workers, which haven't imported anything yet. That's what makes a run-time value (a random port) work with config that's read once, at import ([Test Environment](./environment.md#how-config-is-read)).

## Keep tests independent

- **Unique data.** Tests that share a database shouldn't collide on unique columns: build names with a suffix (`` `acme-${crypto.randomUUID().slice(0, 8)}` ``).
- **No order.** A file should pass on its own (`vitest run path/to/file`) and in any position. When one doesn't, look for state another file left behind, and give it an `onTestReset`.
- **Same time zone as the app.** If the app's database sessions set a time zone, open the test helpers' connections with the same one, or date assertions drift by hours.
- **Fakes chosen by config.** Pick providers by env (`SMS_DRIVER=fake` in `.env.test`) so production code never imports a test fake, and a test can't reach the real provider by accident.
