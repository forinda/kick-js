import type { Generated } from 'kysely'
import type { ColumnBuilder, GeneratedBrand, NotNullBrand } from '../dsl/columns/types'
import type { TableDecl } from '../dsl/table'

/**
 * Pull each column's TS type and nullability into the row shape Kysely
 * consumes as its `Database` interface.
 *
 *   - Columns carrying the `GeneratedBrand` (set by serial / bigSerial /
 *     `default(...)` / `defaultNow()` / `defaultRandom()`) wrap in
 *     Kysely's `Generated<T>` so adopters can omit them on insert.
 *   - `notNull()` / `primaryKey()` stamp `NotNullBrand`, which drops the
 *     `| null` from the row type for that column.
 *   - `jsonb<{...}>()` carries the user-declared shape through without
 *     widening to `unknown`.
 *
 * The `Generated<T> | null` form for nullable + default columns models the
 * SQL semantics: omitted on insert, the DB returns the default; if `null`
 * is explicitly inserted, the DB stores null.
 */
type IsNullable<C> = C extends NotNullBrand ? false : true

type ColumnTSType<C> =
  C extends ColumnBuilder<infer T>
    ? IsNullable<C> extends true
      ? C extends GeneratedBrand
        ? Generated<T> | null
        : T | null
      : C extends GeneratedBrand
        ? Generated<T>
        : T
    : never

export type SchemaToTypes<S> = {
  [K in keyof S as S[K] extends TableDecl<string, Record<string, ColumnBuilder>>
    ? S[K]['__name']
    : never]: S[K] extends TableDecl<string, infer C>
    ? { [Col in keyof C]: ColumnTSType<C[Col]> }
    : never
}
