/**
 * Dialect-agnostic compile traversal for `db.query.X.findMany({ with })`.
 *
 * The compile algorithm is identical across PostgreSQL, SQLite, and
 * MySQL — only the JSON-aggregation primitives differ. Each dialect-
 * specific entry point (`compilePg`, `compileSqlite`, `compileMysql`)
 * passes its own `jsonArrayFrom` / `jsonObjectFrom` from the matching
 * `kysely/helpers/<dialect>` module into `runCompile`, which then
 * walks the `with` clause using shared helpers.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  sql,
  expressionBuilder,
  type Kysely,
  type ExpressionBuilder,
  type Expression,
  type CompiledQuery,
} from 'kysely'
import { RelationalQueryDepthError, RelationalQueryUnknownRelationError } from './errors'
import type { ResolvedRelation, ResolvedRelations } from './relations'
import type { TableSnapshot } from '../snapshot/types'

/** `count` selects `count(*) as total` under the same filters, ignoring `with`, order and paging. */
export type CompileMode = 'many' | 'first' | 'unique' | 'count'

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
  /** Include soft-deleted rows — on this level only. */
  withDeleted?: boolean
  columns?: Record<string, boolean | undefined>
  extras?: Record<string, (table: any, ops: ExpressionBuilder<any, any>) => Expression<unknown>>
}

/** A table as the compiler sees it: its snapshot, plus its soft-delete column if any. */
export type CompileTable = TableSnapshot & { softDelete?: string }

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
  dialect: 'postgres' | 'mysql' | 'sqlite'
}

/**
 * The LIMIT that means none, for an OFFSET without a LIMIT: SQLite and MySQL
 * have no OFFSET on its own (Postgres does).
 */
const NO_LIMIT = { postgres: undefined, sqlite: '-1', mysql: '18446744073709551615' } as const

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
  // No dots: `billing.invoices_0.col` would read as schema `billing`, table
  // `invoices_0` — so a table in a named schema aliases as `billing_invoices_0`.
  return `${name.replaceAll('.', '_')}_${depth}`
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
  tables: Record<string, CompileTable>,
  mode: CompileMode,
  helpers: JsonHelpers,
): CompiledQuery {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH

  const outerAlias = makeAlias(table, 0)
  if (mode === 'count') {
    const count = (db.selectFrom(`${table} as ${outerAlias}` as any) as any).select(
      (eb: ExpressionBuilder<any, any>) => eb.fn.countAll().as('total'),
    )
    const filtered = skipDeleted(count, outerAlias, tables[table], options)
    return applyWhereOrderLimit(
      filtered,
      outerAlias,
      { where: options.where },
      mode,
      helpers,
    ).compile()
  }
  // Outer `.selectAll()` is fine — the helpers only restrict inner
  // subqueries passed to jsonArrayFrom / jsonObjectFrom.
  let query: any = db.selectFrom(`${table} as ${outerAlias}` as any)
  const picked = pickColumns(table, tables[table], options)
  query = picked ? query.select(picked.map((c) => `${outerAlias}.${c}`)) : query.selectAll()
  query = applyExtras(query, outerAlias, options)

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

  query = skipDeleted(query, outerAlias, tables[table], options)
  query = applyWhereOrderLimit(query, outerAlias, options, mode, helpers)

  return query.compile() as CompiledQuery
}

function applyWithSelects(
  query: any,
  source: string,
  sourceAlias: string,
  withClause: Record<string, true | CompileOptions>,
  relations: ResolvedRelations,
  tables: Record<string, CompileTable>,
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
      // Own keys only: `toString` or `constructor` isn't a relation.
      const rel = Object.hasOwn(relations[source] ?? {}, key) ? relations[source]![key] : undefined
      if (!rel) {
        throw new RelationalQueryUnknownRelationError(source, key)
      }

      const subOptions: CompileOptions = value === true ? {} : value
      if (rel.morphTo) {
        out.push(
          buildMorphTo(eb, sourceAlias, rel, key, subOptions, tables, trace.length, helpers).as(
            key,
          ),
        )
        continue
      }
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
  tables: Record<string, CompileTable>,
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
    ? nestedColumns(
        rel.target,
        targetTable,
        pickColumns(rel.target, targetTable, subOptions) ?? Object.keys(targetTable.columns),
        helpers,
      ).map((c) => `${innerAlias}.${c}`)
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

  if (rel.through) {
    // Many-to-many: target rows with a junction row that points at the source.
    // EXISTS rather than a join keeps the junction out of the level's scope, so
    // its `where` on a column both tables have isn't ambiguous; a soft-deleted
    // junction row links nothing (unless the level asks for deleted rows).
    const through = rel.through
    const junctionAlias = `${innerAlias}_j`
    sub = sub.where((w: ExpressionBuilder<any, any>) => {
      let link: any = w
        .selectFrom(`${through.table} as ${junctionAlias}` as any)
        .select(sql.lit(1).as('linked'))
      for (let i = 0; i < through.targetColumns.length; i++) {
        link = link.whereRef(
          `${junctionAlias}.${through.targetColumns[i]}`,
          '=',
          `${innerAlias}.${rel.targetColumns[i]}`,
        )
      }
      for (let i = 0; i < through.sourceColumns.length; i++) {
        link = link.whereRef(
          `${junctionAlias}.${through.sourceColumns[i]}`,
          '=',
          `${sourceAlias}.${rel.sourceColumns[i]}`,
        )
      }
      return w.exists(skipDeleted(link, junctionAlias, tables[through.table], subOptions))
    })
  } else {
    for (let i = 0; i < rel.sourceColumns.length; i++) {
      sub = sub.whereRef(
        `${innerAlias}.${rel.targetColumns[i]}`,
        '=',
        `${sourceAlias}.${rel.sourceColumns[i]}`,
      )
    }
    if (rel.morph) sub = sub.where(`${innerAlias}.${rel.morph.column}`, '=', rel.morph.value)
  }

  sub = applyExtras(sub, innerAlias, subOptions)

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

  sub = skipDeleted(sub, innerAlias, targetTable, subOptions)
  sub = applyWhereOrderLimit(sub, innerAlias, subOptions, 'many', helpers)

  if (rel.kind === 'one') {
    sub = sub.limit(1)
  }

  return sub
}

/**
 * `morphTo`: one single-row subquery per target table, each guarded by the
 * source's type column holding that target's value (bound as a parameter), so
 * at most one is non-null — `coalesce` keeps it. The targets have different
 * columns, so only `withDeleted` applies.
 */
function buildMorphTo(
  eb: ExpressionBuilder<any, any>,
  sourceAlias: string,
  rel: ResolvedRelation,
  key: string,
  options: CompileOptions,
  tables: Record<string, CompileTable>,
  depth: number,
  helpers: JsonHelpers,
): any {
  const other = Object.entries(options).filter(([k, v]) => k !== 'withDeleted' && v !== undefined)
  if (other.length > 0) {
    throw new Error(
      `kickjs-db: morphTo '${key}' takes \`true\` or \`{ withDeleted }\` — its rows come from several tables (got ${other.map(([k]) => k).join(', ')})`,
    )
  }
  const morphTo = rel.morphTo!
  const subs = morphTo.targets.map((t) => {
    const alias = makeAlias(t.table, depth)
    const table = tables[t.table]
    let sub: any = eb.selectFrom(`${t.table} as ${alias}` as any)
    sub = table
      ? sub.select(
          nestedColumns(t.table, table, Object.keys(table.columns), helpers, 'skip').map(
            (c) => `${alias}.${c}`,
          ),
        )
      : sub.selectAll()
    // The type value it was found by, so the subject says which table it is
    // (a parameter; Postgres needs its type to put it in JSON).
    const typeValue = helpers.dialect === 'postgres' ? sql`${t.value}::text` : sql`${t.value}`
    sub = sub
      .select(typeValue.as('__type'))
      .whereRef(`${alias}.${t.key}`, '=', `${sourceAlias}.${rel.sourceColumns[0]}`)
      .where(`${sourceAlias}.${morphTo.column}`, '=', t.value)
    return helpers.jsonObjectFrom(skipDeleted(sub, alias, table, options).limit(1))
  })
  return subs.length === 1 ? subs[0] : (eb.fn.coalesce as any)(...subs)
}

/**
 * A nested level's columns. SQLite's JSON can't hold a blob, so a `bytea`
 * column there is refused by name instead of failing inside the query.
 */
function nestedColumns(
  name: string,
  table: CompileTable,
  columns: string[],
  helpers: JsonHelpers,
  /** `'skip'` for a morphTo target, which can't take `columns` to leave one out. */
  blobs: 'refuse' | 'skip' = 'refuse',
): string[] {
  if (helpers.dialect !== 'sqlite') return columns
  const isBlob = (c: string) => /^(bytea|blob)/i.test(table.columns[c]?.type ?? '')
  if (blobs === 'skip') return columns.filter((c) => !isBlob(c))
  const blob = columns.find(isBlob)
  if (blob) {
    throw new Error(
      `kickjs-db: ${name}.${blob} is a bytea column, which SQLite can't put in a related row's JSON — leave it out with columns: { ${blob}: false }`,
    )
  }
  return columns
}

/**
 * The columns `options.columns` selects, or null to select them all. Either
 * every value is `true` (only those) or every value is `false` (all but
 * those); a mix is refused, as is a column the table doesn't have.
 */
function pickColumns(
  name: string,
  table: CompileTable | undefined,
  options: CompileOptions,
): string[] | null {
  const spec = Object.entries(options.columns ?? {}).filter(([, v]) => v !== undefined)
  if (spec.length === 0 || !table) return null
  for (const [c] of spec) {
    if (!Object.hasOwn(table.columns, c)) {
      throw new Error(`kickjs-db: columns names '${c}', which table '${name}' doesn't have`)
    }
  }
  const included = spec.filter(([, v]) => v).map(([c]) => c)
  if (included.length > 0 && included.length < spec.length) {
    throw new Error(
      `kickjs-db: columns on '${name}' mixes true and false — name the columns to keep, or the ones to leave out`,
    )
  }
  if (included.length > 0) return Object.keys(table.columns).filter((c) => included.includes(c))
  const excluded = new Set(spec.map(([c]) => c))
  const kept = Object.keys(table.columns).filter((c) => !excluded.has(c))
  // An empty list would fall back to every column on a nested level — the
  // opposite of what was asked — so it is refused rather than guessed.
  if (kept.length === 0) {
    throw new Error(`kickjs-db: columns on '${name}' leaves out every column — keep at least one`)
  }
  return kept
}

/** Select each extra's expression under its name. */
function applyExtras(query: any, alias: string, options: CompileOptions): any {
  const extras = Object.entries(options.extras ?? {})
  if (extras.length === 0) return query
  return query.select((eb: ExpressionBuilder<any, any>) =>
    extras.map(([name, build]) => (build(makeTableRefProxy(eb, alias), eb) as any).as(name)),
  )
}

/** Leave out rows whose soft-delete column is set, unless the caller asked for them. */
function skipDeleted(
  query: any,
  alias: string,
  table: CompileTable | undefined,
  options: CompileOptions,
): any {
  if (!table?.softDelete || options.withDeleted) return query
  return query.where(`${alias}.${table.softDelete}`, 'is', null)
}

function applyWhereOrderLimit(
  query: any,
  alias: string,
  options: CompileOptions,
  mode: CompileMode,
  helpers: JsonHelpers,
): any {
  let q = query

  if (options.where) {
    q = q.where((eb: ExpressionBuilder<any, any>) =>
      options.where!(makeTableRefProxy(eb, alias), eb),
    )
  }

  if (options.orderBy) {
    const eb = expressionBuilder<any, any>()
    const order = options.orderBy(makeTableRefProxy(eb, alias), eb)
    // An array is several sort keys; an empty one sorts nothing.
    for (const key of Array.isArray(order) ? order : [order]) q = q.orderBy(key)
  }

  if (typeof options.limit === 'number') {
    q = q.limit(options.limit)
  } else if (mode === 'first' || mode === 'unique') {
    q = q.limit(1)
  }

  if (typeof options.offset === 'number') {
    const none = NO_LIMIT[helpers.dialect]
    // A fixed constant, never input: raw is safe, and MySQL needs it unquoted.
    if (none !== undefined && !q.toOperationNode().limit) q = q.limit(sql.raw(none))
    q = q.offset(options.offset)
  }

  return q
}
