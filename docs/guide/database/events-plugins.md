# Events and Plugins

Two ways to hook into what the client does: **events** to observe every query and transaction, and **plugins** to rewrite queries before they run.

## Lifecycle events

Enable events on the client (`events: true`, or set `slowQueryThresholdMs`) and subscribe with `on()`:

```ts
const db = createDbClient({
  schema,
  dialect: pgDialect({ pool }),
  events: true,
  slowQueryThresholdMs: 100,
})

db.on('query', ({ sql, parameters, durationMs }) => {
  logger.debug({ sql, durationMs }, 'query')
})

db.on('slowQuery', ({ sql, durationMs, thresholdMs }) => {
  logger.warn({ sql, durationMs, thresholdMs }, 'slow query')
})

db.on('queryError', ({ sql, error }) => {
  Sentry.captureException(error, { extra: { sql } })
})
```

| Event                 | Payload                                        | When                                           |
| --------------------- | ---------------------------------------------- | ---------------------------------------------- |
| `beforeQuery`         | `{ sql, parameters }` (mutable)                | before a query runs                            |
| `query`               | `{ sql, parameters, durationMs }`              | after a query succeeds                         |
| `queryError`          | `{ sql, parameters, error }`                   | a query fails                                  |
| `slowQuery`           | `{ sql, parameters, durationMs, thresholdMs }` | a query ran longer than `slowQueryThresholdMs` |
| `transactionStart`    | `{ isolation? }`                               | a transaction opens                            |
| `transactionCommit`   | `{ isolation? }`                               | it commits                                     |
| `transactionRollback` | `{ isolation?, error }`                        | it rolls back                                  |
| `transactionRetry`    | `{ isolation?, attempt, error, delayMs }`      | a `retry` transaction is about to run again    |

Pass the DevTools event bus as `createDbClient({ bus })` and queries are republished as `db:query`, `db:query-error` and `db:slow-query` — what the DevTools **Database** tab shows. A `bus` or `slowQueryThresholdMs` turns events on by itself.

## Plugins

`createDbClient({ plugins })` takes [Kysely plugins](https://kysely.dev/docs/plugins), which transform each query before it's compiled and each result after it returns. kick/db ships one.

### Safe NULL comparison

By default, `eb('col', '=', null)` compiles to `= NULL` (which is silently false in SQL). Pass `safeNullComparison()` so `= null` / `!= null` compile to `IS NULL` / `IS NOT NULL`:

```ts
import { createDbClient, safeNullComparison } from '@forinda/kickjs-db'

const db = createDbClient({
  schema,
  dialect: pgDialect({ pool }),
  plugins: [safeNullComparison()],
})
```

::: warning Use the kickjs version
Import `safeNullComparison()` from `@forinda/kickjs-db`, **not** Kysely's `SafeNullComparisonPlugin` — the upstream version is broken on Postgres.
:::

## Related

- [Observability](../observability#database-queries) — wiring events to your logger and tracer
- [Extensions](../db-extensions) — per-table methods and computed result fields with `$extends`
