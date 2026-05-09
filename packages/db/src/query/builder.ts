/**
 * Runtime wire-up for `db.query.X.findMany({ with })`.
 *
 * `attachQueryNamespace` wraps a `KickDbClient` with a `query`
 * Proxy that materializes a `TableQueryNamespace` on first
 * property access. Each method (`findMany` / `findFirst` /
 * `findUnique`) builds a `CompiledQuery` via the dialect-specific
 * compiler, hands it to the underlying Kysely instance to execute,
 * and returns the rows.
 *
 * The compile + execute split keeps the compiler pure and testable
 * (snapshot SQL fixtures in `query-compile.test.ts`) while the
 * builder owns the I/O.
 *
 * Spec: docs/db/spec-relational-query.md §5.2.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { CompiledQuery, Kysely } from 'kysely'
import type { ResolvedRelations } from './relations'
import type { CompileMode, CompilePgOptions } from './compile-pg'
import type { FindManyOptions, QueryNamespace, TableQueryNamespace } from './types'
import type { TableSnapshot } from '../snapshot/types'
import { RelationalQueryCancelledError } from './errors'

/**
 * Dialect-specific compile function. PG ships `compilePg`;
 * SQLite ships `compileSqlite`; MySQL provides a stub that throws
 * `RelationalQueryNotSupportedError`. The signature matches
 * `compilePg` so swapping compilers is a one-line change.
 *
 * `tables` is the snapshot's table-by-name map; the compiler reads
 * each target's column list to emit explicit selections inside
 * `jsonArrayFrom` / `jsonObjectFrom` (SQLite requires it; PG
 * accepts either form).
 */
export type CompileFn = (
  qb: Kysely<any>,
  table: string,
  options: CompilePgOptions,
  relations: ResolvedRelations,
  tables: Record<string, TableSnapshot>,
  mode: CompileMode,
) => CompiledQuery

/**
 * Build the per-table query namespace. The Proxy intercepts every
 * property access — adopters writing `db.query.users` get a fresh
 * namespace bound to that table name. The methods close over the
 * shared compiler + relations + tables + Kysely instance so each
 * call is independent.
 */
export function buildQueryNamespace<DB>(
  qb: Kysely<DB>,
  relations: ResolvedRelations,
  tables: Record<string, TableSnapshot>,
  compile: CompileFn,
): QueryNamespace<DB> {
  return new Proxy({} as QueryNamespace<DB>, {
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined
      return makeTableNamespace(qb, prop as never, relations, tables, compile)
    },
  })
}

function makeTableNamespace<DB, Table extends keyof DB & string>(
  qb: Kysely<DB>,
  table: Table,
  relations: ResolvedRelations,
  tables: Record<string, TableSnapshot>,
  compile: CompileFn,
): TableQueryNamespace<DB, Table> {
  return {
    async findMany(options?: unknown) {
      const opts = (options ?? {}) as FindManyOptions
      assertNotAlreadyAborted(opts.signal)
      const compiled = compile(
        qb as Kysely<any>,
        table,
        opts as CompilePgOptions,
        relations,
        tables,
        'many',
      )
      const rows = await execute(qb, compiled, opts.signal)
      return rows as never
    },

    async findFirst(options?: unknown) {
      const opts = (options ?? {}) as FindManyOptions
      assertNotAlreadyAborted(opts.signal)
      const compiled = compile(
        qb as Kysely<any>,
        table,
        opts as CompilePgOptions,
        relations,
        tables,
        'first',
      )
      const rows = await execute(qb, compiled, opts.signal)
      return (rows[0] ?? null) as never
    },

    async findUnique(options: unknown) {
      const opts = options as FindManyOptions
      assertNotAlreadyAborted(opts?.signal)
      const compiled = compile(
        qb as Kysely<any>,
        table,
        opts as CompilePgOptions,
        relations,
        tables,
        'unique',
      )
      const rows = await execute(qb, compiled, opts?.signal)
      return (rows[0] ?? null) as never
    },
  } as unknown as TableQueryNamespace<DB, Table>
}

/**
 * Short-circuit before compile when the caller passes an already-
 * aborted signal — no SQL generated, no DB round trip.
 */
function assertNotAlreadyAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new RelationalQueryCancelledError(signal.reason)
  }
}

/**
 * Execute a `CompiledQuery` through Kysely's executor. Goes through
 * the same path Kysely's `.execute()` would — events, plugins, and
 * connection pooling all keep working without bypassing the wrapper.
 *
 * When `signal` is supplied, threads it into Kysely 0.29's
 * `executeQuery(q, { signal })` second arg. Kysely + the dialect
 * driver handle the actual cancellation (PG `pg_cancel_backend`,
 * SQLite synchronous abort, MySQL `KILL QUERY`). On abort, Kysely
 * rejects with an AbortError-shaped error which we map to the
 * adopter-facing `RelationalQueryCancelledError`.
 */
async function execute<DB>(
  qb: Kysely<DB>,
  compiled: CompiledQuery,
  signal?: AbortSignal,
): Promise<unknown[]> {
  try {
    // Kysely 0.29's default `inflightQueryAbortStrategy` is
    // `'ignore query'` — it stops waiting for results on abort but
    // lets the in-flight query finish on the DB side. The stricter
    // `'cancel query'` strategy throws on dialects without
    // `cancelQuery` support (better-sqlite3 has no such hook), so we
    // can't safely default it across all dialects.
    //
    // Adopters who need `pg_cancel_backend` / `KILL QUERY` semantics
    // for long-running PG/MySQL queries can wrap a Kysely call site
    // directly (`db.qb.selectFrom(...).$call(qb => qb.executeQuery(c, { signal, inflightQueryAbortStrategy: 'cancel query' }))`)
    // until a future release exposes a per-call override on
    // FindManyOptions. The signal STILL fires correctly here — the
    // promise rejects with RelationalQueryCancelledError as soon as
    // the abort fires; only the DB-side resource cleanup is
    // best-effort under the default strategy.
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
    // Two paths to a cancellation diagnosis:
    //   1. The supplied signal is now aborted — Kysely 0.29 may
    //      throw the abort `reason` verbatim (string, custom value,
    //      or a DOMException), so we can't rely on the err shape.
    //      The signal state is the authoritative signal here.
    //   2. The driver/Kysely path returned an AbortError-shaped
    //      rejection without a kickjs-supplied signal (e.g. the
    //      caller wrapped their own AbortController upstream and
    //      didn't pass it to us — defensive fallback).
    if (signal?.aborted) {
      throw new RelationalQueryCancelledError(signal.reason ?? err)
    }
    if (isAbortError(err)) {
      throw new RelationalQueryCancelledError(err)
    }
    throw err
  }
}

/**
 * Recognise the AbortError shapes the supported dialect drivers
 * throw on cancellation. Kysely 0.29 normalises the spec DOMException
 * shape; the underlying drivers (pg, mysql2, better-sqlite3) carry
 * dialect-specific markers that we keep checking for in case Kysely's
 * normalisation drifts.
 *
 * - DOM standard / Kysely:   err.name === 'AbortError'
 * - node-postgres:           err.code === '57014' (query_canceled SQLSTATE)
 * - mysql2:                  err.code === 'EAGAIN_QUERY_INTERRUPTED'
 * - better-sqlite3:          err.code === 'SQLITE_INTERRUPT'
 */
function isAbortError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  if (err.name === 'AbortError') return true
  const code = (err as { code?: unknown }).code
  if (typeof code !== 'string') return false
  return code === '57014' || code === 'EAGAIN_QUERY_INTERRUPTED' || code === 'SQLITE_INTERRUPT'
}

/**
 * Type alias used by the client wrap to declare the optional `query`
 * field without importing every helper individually.
 */
export type AttachedQuery<DB> = QueryNamespace<DB>

/**
 * Per-options passthrough type — re-exported for contributors who
 * want to wrap the namespace (testing helpers, query loggers). Most
 * adopters never reach for this.
 */
export type AttachedFindManyOptions<DB, Table extends keyof DB & string> = FindManyOptions<
  DB,
  Table
>
