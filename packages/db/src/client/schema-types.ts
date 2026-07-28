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

/**
 * Table key Kysely sees. A table declared via `pgSchema('billing').table(...)`
 * keys as `'billing.invoices'` — Kysely treats a dotted table name as
 * schema-qualified, so `db.selectFrom('billing.invoices')` resolves without a
 * `withSchema()` call. Unqualified tables keep their bare key, so existing
 * `KickDbSchema['users']` lookups are unchanged.
 *
 * Matched on `__isTable` rather than on `TableDecl<...>` assignability: the
 * schema generic makes a qualified table structurally incompatible with the
 * unqualified default, which would silently drop it from the map.
 */
type TableKey<T> = T extends { __name: infer N extends string }
  ? // `__schema` is OPTIONAL, so its property type is `'billing' | undefined`.
    // Matching it against `infer S extends string` therefore fails and every
    // table silently falls back to its bare key — extract the string member
    // instead, which leaves `never` (→ bare key) for unqualified tables.
    Extract<T extends { __schema?: infer S } ? S : never, string> extends infer Schema
    ? [Schema] extends [never]
      ? N
      : Schema extends string
        ? `${Schema}.${N}`
        : N
    : never
  : never

export type SchemaToTypes<S> = {
  [K in keyof S as S[K] extends { __isTable: true }
    ? TableKey<S[K]>
    : never]: S[K] extends TableDecl<string, infer C, string | undefined>
    ? { [Col in keyof C]: ColumnTSType<C[Col]> }
    : never
}
