# Spec — `AbortSignal` threading on `db.query.*` (M5.A.2)

> **Status:** Draft (2026-05-09). Implementation lives in PR for `M5.A.2` per [`m5-plan.md`](./m5-plan.md).

## Problem

`RequestContext.signal` (kickjs-http) fires when the client disconnects or the request times out. Today, repository methods that issue `db.query.X.findMany(...)` keep running after the signal fires — there's no way to short-circuit the in-flight DB query, the row-fetch finishes, and the rejected response is discarded by the runtime. Adopters who care wrap every call site in a manual `Promise.race([dbCall, signalToReject(ctx.signal)])` — tedious and easy to skip.

Kysely 0.29 shipped `AbortableQueryOptions` on its `executeQuery` API. Threading `RequestContext.signal` through to that path closes the gap end-to-end without per-call-site boilerplate.

## Goal

`db.query.X.findMany`, `findFirst`, `findUnique` accept an optional `signal: AbortSignal`. When it fires:

1. The in-flight query is cancelled at the dialect-appropriate level (`pg_cancel_backend`, SQLite synchronous abort, MySQL `KILL QUERY`).
2. The promise rejects with a new `RelationalQueryCancelledError` (extends `KickDbError`, code `relational_query_cancelled`).
3. No row data is returned, no partial state leaks back through the relational tree.

## Surface

### Type additions

```ts
export interface FindManyOptions<DB, Table> {
  // ... existing fields ...
  /**
   * Cancellation handle. When the signal aborts, the in-flight
   * query is cancelled at the dialect level and the promise rejects
   * with `RelationalQueryCancelledError`.
   *
   * Pass `RequestContext.signal` from kickjs-http to bind the query
   * lifetime to the request lifetime — the query short-circuits when
   * the client disconnects or the request times out.
   *
   * Per-relation `signal` on a `with` value is not supported in
   * M5.A.2: child queries inherit the signal from their parent
   * top-level call. A future spec may relax this if adopter demand
   * surfaces.
   */
  signal?: AbortSignal
}
```

### New error class

```ts
export class RelationalQueryCancelledError extends KickDbError {
  readonly cause?: unknown
  constructor(cause?: unknown) {
    super(
      'relational_query_cancelled',
      `Relational query cancelled by AbortSignal. Cause: ${stringify(cause)}.`,
    )
    this.cause = cause
  }
}
```

### Builder plumb

`packages/db/src/query/builder.ts:execute` passes the signal to Kysely 0.29's `executeQuery` second argument. Any `AbortError` rejection (the shape Kysely throws when the signal fires) is mapped to `RelationalQueryCancelledError`. Other rejections propagate as-is.

```ts
async function execute<DB>(
  qb: Kysely<DB>,
  compiled: CompiledQuery,
  signal?: AbortSignal,
): Promise<unknown[]> {
  try {
    const result = await (
      qb as unknown as {
        executeQuery: (
          q: CompiledQuery,
          opts?: { signal?: AbortSignal },
        ) => Promise<{ rows: unknown[] }>
      }
    ).executeQuery(compiled, signal ? { signal } : undefined)
    return result.rows
  } catch (err) {
    if (isAbortError(err)) throw new RelationalQueryCancelledError(err)
    throw err
  }
}
```

`isAbortError(err)` checks for: `err instanceof Error && err.name === 'AbortError'`, plus the dialect-driver-specific AbortError shapes (pg's `query_canceled` SQLSTATE `57014`, mysql2's `EAGAIN_QUERY_INTERRUPTED`, better-sqlite3's `SQLITE_INTERRUPT`).

## Precedence rules

1. **Single signal per top-level call.** A `signal` on the root `findMany` options applies to every nested LATERAL / correlated subquery in the same compiled query. Inner `with: { posts: { signal } }` is rejected at the type level (the nested options shape doesn't carry `signal`).

2. **Already-aborted signal short-circuits before compile.** If `options.signal.aborted === true` at call time, the function rejects with `RelationalQueryCancelledError` immediately — no SQL generated, no DB round trip.

3. **Mid-flight cancellation is best-effort.** The dialect-level cancel (`pg_cancel_backend` etc.) races with normal completion. If the query finishes before the cancel arrives, the promise resolves normally and the signal-firing is a no-op. This is by design — adopters don't get partial-result rejection for a query that already completed.

4. **No cleanup hook.** If the signal fires after the query completes but before the row decoder runs (vanishingly small window), the rows are discarded but no decode-time cleanup runs. Adopters who need decode-time cancellation should layer their own `Promise.race`.

## Dialect-level cancellation

Kysely 0.29's `AbortableQueryOptions` accepts an `inflightQueryAbortStrategy` field with three modes — `'ignore query'` (the default), `'cancel query'`, `'kill session'`. The kickjs-db builder ships M5.A.2 with the **default `'ignore query'`** strategy because the stricter `'cancel query'` throws upfront on dialects without a `cancelQuery` hook (better-sqlite3 has none, and Kysely refuses to fall back).

What that means per dialect:

| Dialect                              | What aborts on signal                                                                                                             | What the DB sees                                                                               |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| PostgreSQL (`@forinda/kickjs-db-pg`) | The JS-side promise rejects with `RelationalQueryCancelledError` immediately.                                                     | The query keeps running until completion; the connection returns to the pool when it finishes. |
| SQLite (`@forinda/kickjs-db-sqlite`) | Synchronous — the signal can only short-circuit before the call or between statements (better-sqlite3 has no async cancellation). | Same: in-flight statement runs to completion.                                                  |
| MySQL (`@forinda/kickjs-db-mysql`)   | Same as PG — JS-side reject, DB query continues.                                                                                  | Same.                                                                                          |

**Adopters who need true DB-side cancellation** (`pg_cancel_backend`, `KILL QUERY`) for long-running PG/MySQL queries can drive Kysely directly until a future release exposes a per-call override:

```ts
import { sql } from 'kysely'

// Bypass db.query.* and call Kysely's executeQuery directly with
// the strict strategy — only safe on dialects with cancelQuery
// (PG, MySQL).
await db.qb.executeQuery(sql<MyRow>`select … from …`.compile(db.qb), {
  signal: ctx.signal,
  inflightQueryAbortStrategy: 'cancel query',
})
```

A follow-up (`m5.a.2.1` or M6) could surface this as `signal: { signal, strategy?: 'cancel' | 'ignore' }` on FindManyOptions — kept out of M5.A.2 to keep the surface simple and the dialect compatibility uniform.

## Edge cases

### Already-aborted signal at call time

Short-circuit before compile:

```ts
if (options?.signal?.aborted) {
  throw new RelationalQueryCancelledError(options.signal.reason)
}
```

The `reason` field on `AbortSignal` (DOM standard since Node 18) carries whatever the caller passed to `AbortController.abort(reason)`. Default `reason` is a `DOMException` with `name === 'AbortError'`. Threading it into the error's `cause` field lets adopters inspect the upstream cause (HTTP timeout vs explicit cancel vs user disconnect).

### Signal listener leaks

Each call attaches at most one listener to the signal (Kysely's internal handler). When the query resolves or rejects normally, Kysely removes the listener. No-op if the caller passes the same signal to many concurrent queries — each gets its own listener; node's event-emitter doesn't deduplicate.

### Query inside a transaction

Out of scope for M5.A.2 — `db.query.X.*` doesn't accept a transaction handle today; that's a separate roadmap item. When transactions ARE supported in a future release, `signal` on the top-level options will compose naturally (Kysely's transaction `executeQuery` accepts the same options shape).

### Server-side timeout vs client-side signal

Two independent dimensions: the DB driver's connection-level statement timeout (`statement_timeout` on PG, `wait_timeout` on MySQL) is a server-side budget; the `AbortSignal` is a client-side one. They compose: whichever fires first wins. The error surfaces accordingly — PG timeout produces a different SQLSTATE than `pg_cancel_backend`; the builder's `isAbortError` check is narrow enough not to swallow timeout errors.

## What this does NOT change

- The compile path stays pure. `compilePg` / `compileSqlite` / `compileMysql` don't know about signals — they receive `CompileOptions` (no signal field), produce `CompiledQuery`, return. The signal-handling lives entirely in `execute()`.
- The relational-query type registry (`KickDbRelationsRegister`) is untouched. `signal` is on the call-options bag, not the relation registry.
- No new event on the kickjs-db event bus. Adopters who want telemetry on cancellation handle it via their own logging on the catch path.

## Test plan

### Unit (`packages/db/__tests__/unit/abort-signal-unit.test.ts`)

Stub `executeQuery` to observe the `{ signal }` second arg. Cases:

- `findMany` / `findFirst` / `findUnique` each forward a passed signal.
- Already-aborted signal short-circuits before any compile / executeQuery call.
- `AbortError`-shaped rejection from `executeQuery` becomes `RelationalQueryCancelledError`.
- Unrelated rejection (e.g. `TypeError`) passes through verbatim.
- Per-relation `signal` is rejected at the type level (`@ts-expect-error` lock).

### Integration

- `packages/db-pg/__tests__/integration/abort-signal-pg.test.ts` — Testcontainers PG, `SELECT pg_sleep(10)` query, abort the signal at 100ms, assert `RelationalQueryCancelledError` + `pg_stat_activity` shows the backend cancelled (state `idle` or row gone).
- `packages/db-sqlite/__tests__/integration/abort-signal-sqlite.test.ts` — Two-statement query bound to a signal aborted between statements; assert second statement doesn't run.
- `packages/db-mysql/__tests__/integration/abort-signal-mysql.test.ts` — Testcontainers MySQL 8, `SELECT SLEEP(10)`, abort at 100ms, assert cancellation + `KILL QUERY` fired (visible in `INFORMATION_SCHEMA.PROCESSLIST` row gone).

## Migration path for adopters

This ships as a **minor** on `@forinda/kickjs-db`. New optional field on existing options bags + new error class; both are additive. Existing call sites (`db.query.X.findMany({ where, with })` without `signal`) keep working unchanged.

Recommended adoption pattern in HTTP repos:

```ts
@Service()
export class TasksRepository {
  constructor(@Inject(DB_PRIMARY) private readonly db: KickDbClient) {}

  findFullById(id: string, signal: AbortSignal) {
    return this.db.query.tasks.findUnique({
      where: (_t, eb) => eb('id', '=', id),
      with: { comments: true, assignees: true, labels: true },
      signal, // bind to RequestContext.signal at the call site
    })
  }
}

@Controller()
export class TasksController {
  constructor(private readonly tasks: TasksRepository) {}

  @Get('/tasks/:id')
  async show(ctx: RequestContext) {
    return ctx.json(await this.tasks.findFullById(ctx.params.id, ctx.signal))
  }
}
```

When the client disconnects or the request hits the configured timeout, `ctx.signal` fires, the query cancels at PG, and the controller's promise rejects with `RelationalQueryCancelledError` — which the framework maps to `499 Client Closed Request` (or whatever the adopter's error mapper does for cancelled requests).
