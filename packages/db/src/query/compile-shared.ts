/**
 * Dialect-agnostic compile traversal for `db.query.X.findMany({ with })`.
 *
 * The compile algorithm is identical across PostgreSQL, SQLite, and
 * MySQL — only the JSON-aggregation primitives differ. Each dialect-
 * specific entry point (`compilePg`, `compileSqlite`, `compileMysql`)
 * passes its own `jsonArrayFrom` / `jsonObjectFrom` from the matching
 * `kysely/helpers/<dialect>` module into `runCompile`, which then
 * walks the `with` clause using shared helpers.
 *
 * Spec: docs/db/spec-relational-query-other-dialects.md §4.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { type Kysely, type ExpressionBuilder, type Expression, type CompiledQuery } from 'kysely'
import { RelationalQueryDepthError, RelationalQueryUnknownRelationError } from './errors'
import type { ResolvedRelation, ResolvedRelations } from './relations'
import type { TableSnapshot } from '../snapshot/types'

export type CompileMode = 'many' | 'first' | 'unique'

export interface CompileOptions {
  where?: (table: any, ops: ExpressionBuilder<any, any>) => Expression<unknown>
  orderBy?: (
    table: any,
    ops: ExpressionBuilder<any, any>,
  ) => Expression<unknown> | Array<Expression<unknown>>
  limit?: number
  offset?: number
  maxDepth?: number
  with?: Record<string, true | CompileOptions>
}

const DEFAULT_MAX_DEPTH = 5

/**
 * Helper bag passed in from each dialect entry point. Same shape as
 * Kysely's per-dialect helpers — the only thing that varies between
 * `kysely/helpers/postgres`, `kysely/helpers/sqlite`, and
 * `kysely/helpers/mysql`.
 */
export interface JsonHelpers {
  jsonArrayFrom: (expr: Expression<unknown>) => Expression<unknown>
  jsonObjectFrom: (expr: Expression<unknown>) => Expression<unknown>
}

/**
 * Build a Proxy that maps property reads to Kysely column refs.
 * Adopters can write `(u, eb) => eb('id', '=', u.id)` and the runtime
 * resolves `u.id` to `eb.ref('users_0.id')`. Most call sites use the
 * underscored form (`(_u, eb) => eb('id', '=', x)`) and this Proxy
 * silently no-ops.
 */
function makeTableRefProxy(eb: ExpressionBuilder<any, any>, alias: string): unknown {
  return new Proxy({} as Record<string, unknown>, {
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined
      return eb.ref(`${alias}.${prop}`)
    },
  })
}

/**
 * Build a stable alias from a table name + depth index. The depth
 * suffix disambiguates self-referencing or cyclic relations. Outer
 * is `${name}_0`; nested levels increment.
 */
function makeAlias(name: string, depth: number): string {
  return `${name}_${depth}`
}

/**
 * Top-level entry — dialect-specific compilers (`compilePg`,
 * `compileSqlite`, `compileMysql`) call this with the right Kysely
 * helper bag. Returns the compiled `{ sql, parameters }`.
 *
 * `tables` carries each target table's column list so inner
 * `jsonArrayFrom` / `jsonObjectFrom` subqueries can emit explicit
 * `.select([col1, col2, ...])` calls. SQLite's helper requires
 * this (the runtime can't infer the JSON object keys from
 * `.selectAll()`); PG's helper accepts either form.
 */
export function runCompile<DB>(
  db: Kysely<DB>,
  table: string,
  options: CompileOptions,
  relations: ResolvedRelations,
  tables: Record<string, TableSnapshot>,
  mode: CompileMode,
  helpers: JsonHelpers,
): CompiledQuery {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH

  const outerAlias = makeAlias(table, 0)
  // Outer `.selectAll()` is fine — the helpers only restrict inner
  // subqueries passed to jsonArrayFrom / jsonObjectFrom.
  let query: any = (db.selectFrom(`${table} as ${outerAlias}` as any) as any).selectAll()

  if (options.with) {
    query = applyWithSelects(
      query,
      table,
      outerAlias,
      options.with,
      relations,
      tables,
      maxDepth,
      [outerAlias],
      helpers,
    )
  }

  query = applyWhereOrderLimit(query, outerAlias, options, mode)

  return query.compile() as CompiledQuery
}

function applyWithSelects(
  query: any,
  source: string,
  sourceAlias: string,
  withClause: Record<string, true | CompileOptions>,
  relations: ResolvedRelations,
  tables: Record<string, TableSnapshot>,
  maxDepth: number,
  trace: readonly string[],
  helpers: JsonHelpers,
): any {
  if (trace.length > maxDepth) {
    throw new RelationalQueryDepthError(maxDepth, trace)
  }

  return query.select((eb: ExpressionBuilder<any, any>) => {
    const out: unknown[] = []
    for (const [key, value] of Object.entries(withClause)) {
      const rel = relations[source]?.[key]
      if (!rel) {
        throw new RelationalQueryUnknownRelationError(source, key)
      }

      const subOptions: CompileOptions = value === true ? {} : value
      const innerAlias = makeAlias(rel.target, trace.length)
      const inner = buildInnerSelect(
        eb,
        sourceAlias,
        rel,
        innerAlias,
        subOptions,
        relations,
        tables,
        maxDepth,
        trace,
        helpers,
      )

      if (rel.kind === 'many') {
        out.push((helpers.jsonArrayFrom(inner as Expression<unknown>) as any).as(key))
      } else {
        out.push((helpers.jsonObjectFrom(inner as Expression<unknown>) as any).as(key))
      }
    }
    return out
  })
}

function buildInnerSelect(
  eb: ExpressionBuilder<any, any>,
  sourceAlias: string,
  rel: ResolvedRelation,
  innerAlias: string,
  subOptions: CompileOptions,
  relations: ResolvedRelations,
  tables: Record<string, TableSnapshot>,
  maxDepth: number,
  trace: readonly string[],
  helpers: JsonHelpers,
): any {
  // Explicit column list rather than `.selectAll()` — SQLite's
  // jsonArrayFrom / jsonObjectFrom helpers require it. PG's
  // helpers accept either form, so emitting columns explicitly
  // keeps a single dialect-agnostic code path here.
  const targetTable = tables[rel.target]
  const columns = targetTable
    ? Object.keys(targetTable.columns).map((c) => `${innerAlias}.${c}`)
    : null

  let sub: any = eb.selectFrom(`${rel.target} as ${innerAlias}` as any) as any
  if (columns && columns.length > 0) {
    sub = sub.select(columns)
  } else {
    // Fallback only when the table isn't in the snapshot (e.g.
    // tests passing a hand-rolled relations map without a
    // matching tables entry). PG accepts selectAll(); SQLite
    // would throw with a clear Kysely error.
    sub = sub.selectAll()
  }

  for (let i = 0; i < rel.sourceColumns.length; i++) {
    sub = sub.whereRef(
      `${innerAlias}.${rel.targetColumns[i]}`,
      '=',
      `${sourceAlias}.${rel.sourceColumns[i]}`,
    )
  }

  const nextTrace = [...trace, innerAlias]

  if (subOptions.with) {
    sub = applyWithSelects(
      sub,
      rel.target,
      innerAlias,
      subOptions.with,
      relations,
      tables,
      maxDepth,
      nextTrace,
      helpers,
    )
  }

  sub = applyWhereOrderLimit(sub, innerAlias, subOptions, 'many')

  if (rel.kind === 'one') {
    sub = sub.limit(1)
  }

  return sub
}

function applyWhereOrderLimit(
  query: any,
  alias: string,
  options: CompileOptions,
  mode: CompileMode,
): any {
  let q = query

  if (options.where) {
    q = q.where((eb: ExpressionBuilder<any, any>) =>
      options.where!(makeTableRefProxy(eb, alias), eb),
    )
  }

  if (options.orderBy) {
    q = q.orderBy((eb: ExpressionBuilder<any, any>) =>
      options.orderBy!(makeTableRefProxy(eb, alias), eb),
    )
  }

  if (typeof options.limit === 'number') {
    q = q.limit(options.limit)
  } else if (mode === 'first' || mode === 'unique') {
    q = q.limit(1)
  }

  if (typeof options.offset === 'number') {
    q = q.offset(options.offset)
  }

  return q
}
