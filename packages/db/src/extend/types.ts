// `$extends({ model, result })` — adopter extensions for the client.
//
// `model` adds per-table methods accessible as `db.users.findByEmail(...)`.
// Inside each method, `this` is the extended client so chained calls
// (`.transaction()`, `.users.<other>(...)`) Just Work via Proxy
// rebinding — see ./apply.ts for the runtime.
//
// `result` adds COMPUTED COLUMNS to selected rows. Each compute()
// receives the row's selected columns and returns a derived value
// that lands on the row property under the declared key:
//
//   const dbX = db.$extends({
//     result: {
//       posts: {
//         url: {
//           needs: { id: true, slug: true },
//           compute: (row) => `/posts/${row.id}/${row.slug}`,
//         },
//       },
//     },
//   })
//
//   const rows = await dbX.selectFrom('posts').selectAll().execute()
//   rows[0].url  // typed `string`, computed from id + slug
//
// `needs` declares which columns the compute reads. The Kysely plugin
// rewrites the query tree before SQL emit to add any declared `needs`
// column not already in the SELECT list — adopters who write
// `.select(['title'])` still get every needs-column fetched, so the
// computed property fires regardless of which subset of columns the
// caller selected. (The TypeScript row shape only widens with the
// computed property itself; the injected needs columns aren't in the
// declared shape unless the adopter selected them explicitly.)

import type { KickDbClient } from '../client/types'

/**
 * Method bag keyed by table name. Methods receive `this` as the
 * extended client (the runtime calls them with `Function.prototype.call`
 * so the binding is correct). Adopter-side TS annotation:
 * `this: typeof dbX` — fine for v1; full self-typed inference is a
 * separate refactor.
 */
export type ModelExtensions<DB> = {
  [Table in keyof DB & string]?: Record<string, (...args: never[]) => unknown>
}

/**
 * One result extension — declares which columns the compute reads
 * (`needs`) and the function that produces the derived value
 * (`compute`). Sync only in v1; async opens up "runtime queries
 * inside compute" footguns.
 */
export interface ResultExtension<Row> {
  /** Map from column name → `true`. Auto-injected into SELECT list. */
  needs: Partial<Record<keyof Row, true>>
  /** Receives the row's selected columns; return value lands on the row. */
  compute: (row: Row) => unknown
}

/**
 * Result extensions keyed by table name. Each entry is a record of
 * computed-field name → ResultExtension.
 */
export type ResultExtensions<DB> = {
  [Table in keyof DB & string]?: Record<string, ResultExtension<DB[Table]>>
}

/** Top-level shape passed to `db.$extends(...)`. */
export interface ExtensionDefinition<DB> {
  model?: ModelExtensions<DB>
  result?: ResultExtensions<DB>
}

/**
 * Fold result extensions into the DB row shape. For each table that
 * has computeds, every row gains the computed properties typed by the
 * compute function's return type.
 *
 * Implementation note: `compute(row: Row)` is contravariant in `Row`,
 * so the obvious-looking `R[T] extends Record<string, ResultExtension<unknown>>`
 * check fails — `ResultExtension<Row>` doesn't extend
 * `ResultExtension<unknown>` under strictFunctionTypes. We use
 * `(row: never)` as the variance-neutral position: every adopter
 * compute extends `(row: never) => unknown`, so the check passes
 * uniformly.
 */
export type DBWithResults<DB, R> = {
  [T in keyof DB]: T extends keyof R ? DB[T] & ComputedFields<R[T]> : DB[T]
}

/** Map a computed-bag to a record of computed-field name → return type. */
type ComputedFields<Bag> =
  Bag extends Record<string, { compute: (row: never) => unknown }>
    ? {
        [K in keyof Bag]: Bag[K] extends { compute: (row: never) => infer Out } ? Out : unknown
      }
    : // eslint-disable-next-line @typescript-eslint/no-empty-object-type
      {}

/**
 * Result type of `db.$extends(...)` — the client typed against the
 * (possibly result-augmented) DB, intersected with the per-table
 * method bag from `model`.
 */
export type ExtendedClient<DB, E extends ExtensionDefinition<DB>> = KickDbClient<
  E['result'] extends ResultExtensions<DB> ? DBWithResults<DB, NonNullable<E['result']>> : DB
> & {
  [T in keyof NonNullable<E['model']> & keyof DB & string]: NonNullable<NonNullable<E['model']>[T]>
}
