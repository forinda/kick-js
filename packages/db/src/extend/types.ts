// $extends({ model }) — adopter-defined methods grouped by table.
//
// Surface usage:
//
//   const dbX = db.$extends({
//     model: {
//       users: {
//         async findByEmail(this: typeof dbX, email: string) {
//           return this.selectFrom('users')
//             .selectAll()
//             .where('email', '=', email)
//             .executeTakeFirst()
//         },
//       },
//     },
//   })
//
//   await dbX.users.findByEmail('a@b.com')
//
// Inside each method, `this` is the extended client itself — chained
// calls (`.transaction()` on dbX, etc.) Just Work because `this`
// includes both the original KickDbClient surface AND the model-method
// bag from `$extends`. Methods can call other methods on the same
// table by addressing them through `this.<table>.<method>`.
//
// Result extensions (compute() that runs post-fetch) are NOT shipped
// in v1 — that needs a Kysely plugin walking select results, lands as
// a follow-up alongside the toDriver insert path.

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

/** Top-level shape passed to `db.$extends(...)`. */
export interface ExtensionDefinition<DB> {
  model?: ModelExtensions<DB>
}

/**
 * Result type of `db.$extends({ model })` — the original client
 * intersected with a per-table method bag. Adopters who want the
 * result type to flow elsewhere can `type DbX = ReturnType<typeof
 * extend>`; the inference is structural so usage stays clean.
 */
export type ExtendedClient<DB, E extends ExtensionDefinition<DB>> = KickDbClient<DB> & {
  [T in keyof NonNullable<E['model']> & keyof DB & string]: NonNullable<NonNullable<E['model']>[T]>
}
