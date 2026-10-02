---
description: How kick/db uses database connections — one pool per process, sizing it, PgBouncer and serverless Postgres, MySQL and SQLite settings, transactions, and closing the pool on shutdown.
---

# Connections and Pooling

kick/db doesn't open connections itself. You create the pool — `pg.Pool`, a `mysql2` pool, a `better-sqlite3` handle — and hand it to both the query client and the migration adapter. This page covers how to size and configure it, and how to close it.

## One pool per process

Build the pool once, in `src/db/client.ts`, and pass the same object to both factories:

```ts
// src/db/client.ts
import { Pool } from 'pg'
import { createDbClient } from '@forinda/kickjs-db'
import { pgAdapter, pgDialect } from '@forinda/kickjs-db/pg'
import * as schema from './schema'

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 })

export const db = createDbClient({ schema, dialect: pgDialect({ pool }) })
export const migrationAdapter = pgAdapter({ pool, endPoolOnClose: true })
```

One pool means one connection limit to reason about. Two pools in the same process — say one for queries and one for migrations — each hold idle connections, and together they can exceed what you budgeted. The CLI is the exception: `kick db` runs as its own process, so the `db.adapter()` factory in `kick.config.ts` opens its own pool ([Migrations](./migrations.md)).

## Postgres

The `pg.Pool` options that matter:

| Option                    | What it does                                                             | Start with                                 |
| ------------------------- | ------------------------------------------------------------------------ | ------------------------------------------ |
| `max`                     | connections this process may open                                        | `10`                                       |
| `idleTimeoutMillis`       | close a connection idle this long                                        | `10_000` (the default)                     |
| `connectionTimeoutMillis` | give up waiting for a connection after this long (default: wait forever) | `5_000`                                    |
| `statement_timeout`       | the server cancels any statement running longer (ms)                     | your slowest legitimate query, with margin |

Set `connectionTimeoutMillis`. Without it, a request that can't get a connection waits forever, and a pool exhausted by slow queries turns into requests that hang without an error.

**Sizing.** Postgres accepts `max_connections` connections in total (100 by default), shared by every client. Each app instance opens up to `max`, so `max × instances` — plus the CLI, cron jobs and your own `psql` sessions — has to fit under it. Ten instances with `max: 10` use all 100. Scaling out means lowering `max` or adding a pooler.

### PgBouncer and other poolers

In **transaction** mode, PgBouncer gives your process a server connection for the length of one transaction, then hands it to someone else. kick/db works with that:

- Each query outside a transaction, and each `db.transaction()`, gets one server connection.
- The migration lock is a row in `kick_migrations_lock`, not a session-level advisory lock, so migrations work through the pooler too.
- Kysely doesn't use named prepared statements, which transaction mode doesn't support.

What doesn't survive transaction mode is anything you set on the session yourself: a `SET` outside a transaction, `LISTEN`, or session advisory locks. Use `SET LOCAL` inside a transaction instead. Point `kick db migrate` at the pooler or straight at Postgres; either works.

### Serverless Postgres

`pgDialect` and `pgAdapter` accept any pool with `pg.Pool`'s shape. [Drivers](./drivers.md) lists the ones meant to fit, such as `@neondatabase/serverless`'s `Pool`. kick/db's own tests run against `pg`, so test your driver's transactions before you rely on them. On platforms that freeze the process between requests, keep `max` low and `idleTimeoutMillis` short; connections opened before a freeze may be dead when it thaws.

## MySQL

```ts
import { createPool } from 'mysql2/promise'

const pool = createPool({
  uri: process.env.DATABASE_URL,
  connectionLimit: 10, // like pg's max
  waitForConnections: true, // queue when all are busy (the default)
  timezone: 'Z', // read and write dates as UTC
})
```

`connectionLimit` counts against the server's `max_connections` the same way `max` does on Postgres. `timezone: 'Z'` keeps dates from shifting on a host that isn't on UTC — see [Get started on MySQL](./get-started-mysql.md).

## SQLite

`better-sqlite3` is one synchronous handle, not a pool. Queries run one at a time in your process, which is fast for small apps and fine for tests. Set three pragmas when you open the file:

```ts
import Database from 'better-sqlite3'

const database = new Database(process.env.DB_FILE ?? 'app.db')
database.pragma('journal_mode = WAL') // readers don't block the writer
database.pragma('busy_timeout = 5000') // wait up to 5s for a lock instead of failing with SQLITE_BUSY
database.pragma('foreign_keys = ON') // SQLite leaves foreign keys off by default
```

WAL and `busy_timeout` matter when another process opens the same file — `kick db migrate` while the app runs, or a second app instance. `foreign_keys = ON` is per connection and needed for `references()` and `onDelete: 'cascade'` to do anything.

## Read replicas

Give the client a replica — or several — and reads outside a transaction go there:

```ts
export const db = createDbClient({
  schema,
  dialect: pgDialect({ pool }),
  replica: pgDialect({ pool: replicaPool }), // or [pgDialect(...), pgDialect(...)], used in turn
})
```

| Query                                               | Goes to     |
| --------------------------------------------------- | ----------- |
| `selectFrom`, `db.query` — outside a transaction    | a replica   |
| `insertInto`, `updateTable`, `deleteFrom`, `upsert` | the primary |
| anything inside `transaction()`                     | the primary |
| `db.qb`, raw ``sql`…`.execute(db.qb)``              | the primary |
| anything through `db.primary`                       | the primary |

Replicas lag behind the primary. A read that must see a write made a moment ago — the redirect after a form post, the response that returns what was just saved — goes through `db.primary`: `db.primary.query.posts.findFirst(…)`. `db.findOrCreate()` and `db.upsert()` already read the primary. `db.destroy()` closes the replicas too.

## Transactions hold a connection

A `db.transaction()` keeps one connection for its whole duration — every query inside it, including those made by services holding the plain client, runs on that connection. While it's open, the connection serves nobody else.

So keep slow work out. An HTTP call, a file upload or an email send inside a transaction holds a connection for as long as it takes. With `max: 10`, ten slow requests stop the app. Do the database work in the transaction, and the rest after it commits:

```ts
await db.transaction(async () => {
  const order = await orders.create(cart)
  await db.afterCommit(() => mailer.sendReceipt(order)) // runs once the connection is released
})
```

[Transactions](./transactions.md#after-commit) covers `afterCommit`.

## Closing the pool on shutdown

`kickDbAdapter` closes the migration adapter when the app shuts down. A migration adapter leaves its pool open by default, because the pool is usually shared with the query client. Pass `endPoolOnClose: true` to the app's adapter, as in the first example, and the shared pool ends with the app. Without it, open connections can keep the process alive after a graceful shutdown.

`mysqlAdapter` takes the same option. A SQLite handle doesn't keep the process alive.

## When the database can't be reached

A refused or dropped connection throws `ConnectionError`, not the driver's own error, on every dialect:

```ts
import { ConnectionError } from '@forinda/kickjs-db'

try {
  await db.selectFrom('users').selectAll().execute()
} catch (err) {
  if (err instanceof ConnectionError) {
    // the database is down or unreachable — retry later, or answer 503
  }
  throw err
}
```

Left unhandled, it answers `500` and is logged. [Errors](./errors.md) lists the rest, and [Troubleshooting](./troubleshooting.md) covers the usual causes.

## Related

- [Drivers](./drivers.md) — each dialect's factories and capabilities
- [Performance](./performance.md) — fewer, cheaper queries
- [Transactions](./transactions.md) — isolation, retries, `afterCommit`
