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
      const compiled = compile(
        qb as Kysely<any>,
        table,
        (options ?? {}) as CompilePgOptions,
        relations,
        tables,
        'many',
      )
      const rows = await execute(qb, compiled)
      return rows as never
    },

    async findFirst(options?: unknown) {
      const compiled = compile(
        qb as Kysely<any>,
        table,
        (options ?? {}) as CompilePgOptions,
        relations,
        tables,
        'first',
      )
      const rows = await execute(qb, compiled)
      return (rows[0] ?? null) as never
    },

    async findUnique(options: unknown) {
      const compiled = compile(
        qb as Kysely<any>,
        table,
        options as CompilePgOptions,
        relations,
        tables,
        'unique',
      )
      const rows = await execute(qb, compiled)
      return (rows[0] ?? null) as never
    },
  } as unknown as TableQueryNamespace<DB, Table>
}

/**
 * Execute a `CompiledQuery` through Kysely's executor. Goes through
 * the same path Kysely's `.execute()` would — events, plugins, and
 * connection pooling all keep working without bypassing the wrapper.
 */
async function execute<DB>(qb: Kysely<DB>, compiled: CompiledQuery): Promise<unknown[]> {
  // `executeQuery` is the documented escape hatch for compiled
  // queries — used by Kysely itself when a transaction handler
  // builds and runs SQL programmatically.
  const result = await (
    qb as unknown as {
      executeQuery: (q: CompiledQuery) => Promise<{ rows: unknown[] }>
    }
  ).executeQuery(compiled)
  return result.rows
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
