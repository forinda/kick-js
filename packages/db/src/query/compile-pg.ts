/**
 * PostgreSQL compiler for `db.query.X.findMany({ with })`.
 *
 * Strategy locked in `docs/db/spec-relational-query.md` §4.1:
 *
 *  - Each `many` relation becomes a Kysely `jsonArrayFrom(...)`
 *    select expression (PG: `coalesce((select json_agg(agg) from
 *    (...) as agg), '[]')`). Empty inner result aggregates to `[]`,
 *    not `null`.
 *  - Each `one` relation becomes `jsonObjectFrom(...)` (PG:
 *    `(select to_json(obj) from (...) as obj)`). Empty inner result
 *    is `null`, matching the `Related | null` type.
 *  - Nested `with` recurses: the inner `selectFrom(target)` itself
 *    grows another `.select(eb => [jsonArrayFrom(...).as(...)])` per
 *    nested key.
 *  - The compiler is a pure transformation: take Kysely + table +
 *    options + resolved-relations sidecar, return `{ sql, parameters
 *    }`. No I/O, no client lookups.
 *
 * Why Kysely (not raw SQL strings): Kysely owns identifier quoting,
 * parameter binding, and the LATERAL/JSON helpers per dialect. Hand-
 * rolling SQL would re-implement all three.
 *
 * The compiler internals use `any` at the dynamic builder boundary
 * because table names and with-keys come in as runtime strings; the
 * public surface in `types.ts` is fully typed at the call site.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { type Kysely, type ExpressionBuilder, type Expression, type CompiledQuery } from 'kysely'
import { jsonArrayFrom, jsonObjectFrom } from 'kysely/helpers/postgres'
import { RelationalQueryDepthError, RelationalQueryUnknownRelationError } from './errors'
import type { ResolvedRelation, ResolvedRelations } from './relations'

export type CompileMode = 'many' | 'first' | 'unique'

export interface CompilePgOptions {
  where?: (table: any, ops: ExpressionBuilder<any, any>) => Expression<unknown>
  orderBy?: (
    table: any,
    ops: ExpressionBuilder<any, any>,
  ) => Expression<unknown> | Array<Expression<unknown>>
  limit?: number
  offset?: number
  maxDepth?: number
  with?: Record<string, true | CompilePgOptions>
}

const DEFAULT_MAX_DEPTH = 5

/**
 * Build a Proxy that maps property reads to Kysely column refs. Lets
 * adopters write `(u, ops) => ops.eq(u.id, x)` — `u.id` resolves to
 * `eb.ref('users.id')` at runtime.
 */
function makeTableRefProxy(eb: ExpressionBuilder<any, any>, alias: string): unknown {
  return new Proxy({} as Record<string, unknown>, {
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined
      return eb.ref(`${alias}.${prop}`)
    },
  })
}

export function compilePg<DB>(
  db: Kysely<DB>,
  table: string,
  options: CompilePgOptions,
  relations: ResolvedRelations,
  mode: CompileMode = 'many',
): CompiledQuery {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH

  let query: any = (db.selectFrom(table as any) as any).selectAll()

  if (options.with) {
    query = applyWithSelects(query, table, options.with, relations, maxDepth, [table])
  }

  query = applyWhereOrderLimit(query, table, options, mode)

  return query.compile() as CompiledQuery
}

function applyWithSelects(
  query: any,
  source: string,
  withClause: Record<string, true | CompilePgOptions>,
  relations: ResolvedRelations,
  maxDepth: number,
  trace: readonly string[],
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

      const subOptions: CompilePgOptions = value === true ? {} : value
      const inner = buildInnerSelect(eb, source, rel, subOptions, relations, maxDepth, trace)

      if (rel.kind === 'many') {
        out.push(jsonArrayFrom(inner as Expression<unknown>).as(key))
      } else {
        out.push(jsonObjectFrom(inner as Expression<unknown>).as(key))
      }
    }
    return out
  })
}

function buildInnerSelect(
  eb: ExpressionBuilder<any, any>,
  sourceTable: string,
  rel: ResolvedRelation,
  subOptions: CompilePgOptions,
  relations: ResolvedRelations,
  maxDepth: number,
  trace: readonly string[],
): any {
  let sub: any = (eb.selectFrom(rel.target as any) as any).selectAll()

  for (let i = 0; i < rel.sourceColumns.length; i++) {
    sub = sub.whereRef(
      `${rel.target}.${rel.targetColumns[i]}`,
      '=',
      `${sourceTable}.${rel.sourceColumns[i]}`,
    )
  }

  const nextTrace = [...trace, rel.target]

  if (subOptions.with) {
    sub = applyWithSelects(sub, rel.target, subOptions.with, relations, maxDepth, nextTrace)
  }

  sub = applyWhereOrderLimit(sub, rel.target, subOptions, 'many')

  if (rel.kind === 'one') {
    sub = sub.limit(1)
  }

  return sub
}

function applyWhereOrderLimit(
  query: any,
  alias: string,
  options: CompilePgOptions,
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
