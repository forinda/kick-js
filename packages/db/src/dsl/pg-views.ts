import type { ColumnBuilder, TypedColumnRefs } from './columns/types'
import { buildView, type MaterializedViewOptions, type ViewDecl } from './view'

/**
 * A materialized view (Postgres): the `SELECT`'s result stored as a table,
 * read fast and brought up to date with `db.refreshMaterializedView(name)`.
 *
 * ```ts
 * export const dailySales = materializedView(
 *   'daily_sales',
 *   { day: date().notNull(), total: numeric(12, 2, { mode: 'number' }).notNull() },
 *   {
 *     as: `SELECT created_at::date AS day, sum(amount) AS total FROM orders GROUP BY 1`,
 *     constraints: (t) => ({ byDay: unique('daily_sales_day').on(t.day) }),
 *   },
 * )
 * ```
 */
export function materializedView<TName extends string, C extends Record<string, ColumnBuilder>>(
  name: TName,
  columns: C,
  options: MaterializedViewOptions<C>,
): ViewDecl<TName, C, undefined> & TypedColumnRefs<C> {
  return buildView(name, columns, options.as, true, options.constraints, undefined)
}
