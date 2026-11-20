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

## One container per service: `kickTestServices`

Start each real service (Postgres, MySQL, Redis, MinIO) once for the whole run in Vitest's `globalSetup`, not once per file:

```ts
// tests/global-setup.ts
import { kickTestServices } from '@forinda/kickjs-testing'

export default kickTestServices({
  postgres: { name: 'myapp-test-pg' },
  redis: { name: 'myapp-test-redis' },
})
```

```ts
// vitest.config.ts
export default defineConfig({ test: { globalSetup: ['tests/global-setup.ts'] } })
```

- **Every service starts at once.** Each URL reaches the test files as `inject('postgres')`, and as `process.env.KICK_TEST_POSTGRES_URL`. The env var works for config read at import ([Test Environment](./environment.md#how-config-is-read)).
- **Each file needs its own data.** A database per file on the shared server is the usual answer: `useTestDb()` from `@forinda/kickjs-db/testing/vitest` ([Testing with kick/db](../database/testing.md#against-a-real-server)).
- **Presets:** `postgres` (`postgres:17-alpine`), `mysql` (`mysql:8.4`, as `root`), `redis` (`redis:7-alpine`) and `minio` (an S3-compatible store with an empty `test` bucket). Postgres and MySQL keep their data in memory with disk syncing off, since test data never has to survive a crash.
- **Overriding a preset:**
  - `image` picks another tag.
  - `env` is merged over the preset's, and the URL follows it (`env: { POSTGRES_DB: 'app_test' }` gives `…/app_test`).
  - `command` replaces the preset's flags.
  - `tmpfs: false` keeps data on disk.
  - `hostPort` fixes the host port instead of a random one. Use it only when a tool outside the tests needs a known port: two runs at once then clash on it.
- **Anything else:** `{ container: { image, port, env, command, waitFor: { log }, url: (host, port, env) => … } }`.
- **Typing `inject`:** your own keys need declaring: `declare module '@forinda/kickjs-testing' { interface KickTestServices { search: string } }`. Importing `@forinda/kickjs-testing/vitest` anywhere in your tests (`useTestApp` lives there) makes `inject()` know them.
- **Import it from the package root** in a global setup, as above. A global setup runs outside Vitest's workers, and the root entry doesn't load `vitest`.

Both helpers need Docker and the `testcontainers` package (`pnpm add -D testcontainers`), an optional peer loaded only when you call them.

## Reused containers

A named service is **reused**: the next local run attaches to the running container instead of starting a new one, so a repeated run starts in well under a second. It also means your machine keeps one container per name, not one per run.

- **It stays up between runs.** `stop()` and the setup's teardown leave a reused container running.
- **One per name.** If you change its config (image, env, command, port, tmpfs), the old container is replaced next run, if it's stopped. If it's running, the run fails with a message instead: it may belong to another checkout using the same name, so it's never removed automatically. Stop it, or give your suite another name.
- **CI starts clean.** When `CI` is set, reuse (and naming) are off: each CI run starts fresh containers and removes them afterwards. `reuse: true` forces reuse anyway, `reuse: false` turns it off locally too, and `TESTCONTAINERS_REUSE_ENABLE=false` turns it off for everything.
- **Cleaning up.** `kick test:services ls` shows the test containers, and `kick test:services down [names…]` stops and removes them. Both only ever touch containers these helpers started (labelled `kickjs.test`). Add the commands to your CLI:

```ts
// kick.config.ts
import { testServicesCliPlugin } from '@forinda/kickjs-testing/cli'

export default defineConfig({ plugins: [testServicesCliPlugin] })
```

## A service per file: `startService()`

When a file needs its own server (one it changes server-wide, say, with roles or extensions), start it in the file and give the app its address through a [settings section](../configuration.md#supplying-the-value-provide):

```ts
import { createTestApp, startService } from '@forinda/kickjs-testing'

const pg = await startService('postgres') // unnamed: a fresh container, stopped by stop()
afterAll(() => pg.stop())

const { app } = await createTestApp({
  modules,
  settings: [DbSettings.provide({ url: pg.url })],
})
```

`startService` takes the same options as a `kickTestServices` entry (`name`, `reuse`, `image`, `env`, `command`, `tmpfs`, `hostPort`). `startContainer({ image, port, … })` starts anything else. Each returns `{ url, host, port, reused, stop() }`. A container takes seconds to start, so prefer one per run (above) when you can.

## Keep tests independent

- **Unique data.** Tests that share a database shouldn't collide on unique columns: build names with a suffix (`` `acme-${crypto.randomUUID().slice(0, 8)}` ``).
- **No order.** A file should pass on its own (`vitest run path/to/file`) and in any position. When one doesn't, look for state another file left behind, and give it an `onTestReset`.
- **Same time zone as the app.** If the app's database sessions set a time zone, open the test helpers' connections with the same one, or date assertions drift by hours.
- **Fakes chosen by config.** Pick providers by env (`SMS_DRIVER=fake` in `.env.test`) so production code never imports a test fake, and a test can't reach the real provider by accident.
