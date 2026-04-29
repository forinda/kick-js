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
// `needs` declares which columns the compute reads. The runtime
// auto-injects them into the SELECT list at compile time so adopters
// who write `.select(['title'])` still get every needs-column on the
// row (the computed property fires regardless of which subset of
// columns the caller actually selected).

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
 */
export type DBWithResults<DB, R> = {
  [T in keyof DB]: T extends keyof R
    ? R[T] extends Record<string, ResultExtension<unknown>>
      ? DB[T] & {
          [K in keyof R[T]]: R[T][K] extends { compute: (row: never) => infer Out } ? Out : unknown
        }
      : DB[T]
    : DB[T]
}

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
