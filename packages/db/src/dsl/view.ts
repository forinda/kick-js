import type { ColumnBuilder, TypedColumnRefs } from './columns/types'
import type { IndexDecl } from './constraints'
import { buildTable, type TableDecl } from './table'

/** What makes a table declaration a view: its SQL, and whether it's materialized. */
export interface ViewMarks {
  __isView: true
  /** The `SELECT` the view is defined as, passed to the database as written. */
  __definition: string
  __materialized: boolean
}

export type ViewDecl<
  TName extends string = string,
  C extends Record<string, ColumnBuilder> = Record<string, ColumnBuilder>,
  TSchema extends string | undefined = string | undefined,
> = TableDecl<TName, C, TSchema> & ViewMarks

export interface ViewOptions {
  /** The `SELECT` the view is defined as, in your database's SQL. */
  as: string
}

export interface MaterializedViewOptions<
  C extends Record<string, ColumnBuilder>,
> extends ViewOptions {
  /**
   * Indexes on the materialized view — a unique one lets
   * `refreshMaterializedView(name, { concurrently: true })` run without
   * blocking reads.
   */
  constraints?: (refs: TypedColumnRefs<C>) => Record<string, IndexDecl>
}

/** @internal Shared by `view()` and `materializedView()`. */
export function buildView<
  TName extends string,
  C extends Record<string, ColumnBuilder>,
  TSchema extends string | undefined,
>(
  name: TName,
  columns: C,
  definition: string,
  materialized: boolean,
  constraints: ((refs: TypedColumnRefs<C>) => Record<string, IndexDecl>) | undefined,
  schema: TSchema,
): ViewDecl<TName, C, TSchema> & TypedColumnRefs<C> {
  if (!definition.trim()) throw new Error(`kickjs-db: view '${name}' needs its SELECT in \`as\``)
  const decl = buildTable(name, columns, constraints, schema)
  // A view is read like a table, so it stays a table declaration — row types,
  // codecs and db.query work unchanged; only the snapshot treats it apart.
  Object.assign(decl, {
    __isView: true,
    __definition: definition.trim().replace(/;\s*$/, ''),
    __materialized: materialized,
  } satisfies ViewMarks)
  return decl as ViewDecl<TName, C, TSchema> & TypedColumnRefs<C>
}

/**
 * A view: a stored `SELECT` you query like a table. The columns declare what
 * it returns, for the typed client — they aren't checked against the SQL.
 *
 * ```ts
 * export const activeUsers = view(
 *   'active_users',
 *   { id: integer().notNull(), email: text().notNull() },
 *   { as: 'SELECT id, email FROM users WHERE deleted_at IS NULL' },
 * )
 * ```
 *
 * Migrations create it after the tables and drop it before them, and drop and
 * re-create it around a change to a table its SQL names.
 */
export function view<TName extends string, C extends Record<string, ColumnBuilder>>(
  name: TName,
  columns: C,
  options: ViewOptions,
): ViewDecl<TName, C, undefined> & TypedColumnRefs<C> {
  return buildView(name, columns, options.as, false, undefined, undefined)
}

/** Whether a declaration is a view. */
export function isView(value: unknown): value is ViewDecl {
  return !!value && typeof value === 'object' && (value as Partial<ViewMarks>).__isView === true
}
