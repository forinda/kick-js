import type { Generated } from 'kysely'
import type { ColumnBuilder, GeneratedBrand } from '../dsl/columns/types'
import type { TableDecl } from '../dsl/table'

/**
 * Pull each column's TS type and nullability into the row shape Kysely
 * consumes as its `Database` interface.
 *
 *   - Columns carrying the `GeneratedBrand` (set by serial / bigSerial /
 *     `default(...)` / `defaultNow()` / `defaultRandom()`) wrap in
 *     Kysely's `Generated<T>` so adopters can omit them on insert.
 *   - `notNull()` / `primaryKey()` flip `TNullable` to `false`, so the
 *     row type drops the `| null` for those columns.
 *   - `jsonb<{...}>()` carries the user-declared shape through without
 *     widening to `unknown`.
 *
 * The `Generated<...> | null` form for nullable+default columns models
 * the SQL semantics: omitted on insert, the DB returns the default; if
 * `null` is explicitly inserted, the DB stores null.
 */
type ColumnTSType<C> = C extends GeneratedBrand
  ? C extends ColumnBuilder<infer T, infer Nullable>
    ? Nullable extends true
      ? Generated<T> | null
      : Generated<T>
    : never
  : C extends ColumnBuilder<infer T, infer Nullable>
    ? Nullable extends true
      ? T | null
      : T
    : never

export type SchemaToKysely<S> = {
  [K in keyof S as S[K] extends TableDecl<Record<string, ColumnBuilder>>
    ? S[K]['__name']
    : never]: S[K] extends TableDecl<infer C> ? { [Col in keyof C]: ColumnTSType<C[Col]> } : never
}
