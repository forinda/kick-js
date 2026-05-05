/**
 * Type-level shape of `db.query.X.findMany({ with })` — see
 * `docs/db/spec-relational-query.md` §3 for the locked design.
 *
 * The type story has three layers:
 *
 *  1. `KickDbRelationsRegister` — adopter-augmentable registry of the
 *     relation graph, mirroring `KickDbRegister`. The kick/db typegen
 *     plugin emits the augmentation alongside the column-shape one;
 *     adopters never write it by hand.
 *
 *  2. `FindManyOptions<DB, Table>` — the options bag accepted by
 *     `findMany` / `findFirst` / `findUnique`. `with` keys are
 *     constrained to the relations declared for `Table`; nested
 *     `with` recursively constrains in the same way.
 *
 *  3. `FindManyRow<DB, Table, Opts>` — the resolved row shape. Base
 *     columns of `Table` plus one slot per requested `with` key,
 *     narrowed by relation kind (`one` → `Related | null`, `many` →
 *     `Related[]`).
 *
 * `DB` defaults to `RegisteredDB` so call sites that use the bare
 * `KickDbClient` (i.e. rely on the `KickDbRegister` augmentation) get
 * the resolved shape without an explicit generic. Call sites with an
 * explicit `KickDbClient<MySchema>` thread `MySchema` through, and
 * the global registry only contributes the relation graph.
 *
 * No depth counter on the recursive forms: TypeScript's default
 * recursion limit (~50) covers the spec's runtime guard (5) with
 * orders of magnitude of headroom. The runtime throws
 * `RelationalQueryDepthError` before any SQL is compiled if a call
 * exceeds `maxDepth`.
 */

import type { Expression, ExpressionBuilder } from 'kysely'
import type { RegisteredDB } from '../client/register'

/**
 * Adopter-augmented at typegen time, mirroring `KickDbRegister`. The
 * augmentation slots a record keyed by table name; each value is a
 * record of `{ relationName: RelationMapEntry }`. The kick/db typegen
 * plugin emits this alongside the column-shape augmentation.
 *
 *   declare module '@forinda/kickjs-db' {
 *     interface KickDbRelationsRegister {
 *       db: {
 *         users:    { posts: { kind: 'many'; target: 'posts' } }
 *         posts:    { author: { kind: 'one';  target: 'users' }, comments: { kind: 'many'; target: 'comments' } }
 *         comments: { post:   { kind: 'one';  target: 'posts' } }
 *       }
 *     }
 *   }
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface KickDbRelationsRegister {}

/**
 * One relation entry in the registry — kind (`'one'` or `'many'`) +
 * the target table name. The target is a plain string key so the
 * registry stays decoupled from any particular `DB` generic; the
 * compile-time check that `target` lives in the local `DB` happens
 * inside `WithClause`.
 *
 * `relationName` (optional) is the pairing tag from
 * `relations()`'s helpers. When set, the resolver uses it to pair
 * `one` + `many` declarations across multi-FK schemas. See
 * docs/db/spec-relation-name.md (M4.B).
 */
export interface RelationMapEntry {
  kind: 'one' | 'many'
  target: string
  relationName?: string
}

/**
 * The full registered relation graph. Falls back to an open-shaped
 * record when the adopter hasn't augmented `KickDbRelationsRegister`,
 * preserving the M1-permissive baseline.
 */
export type RegisteredRelations = KickDbRelationsRegister extends { db: infer R }
  ? R extends Record<string, Record<string, RelationMapEntry>>
    ? R
    : Record<string, Record<string, RelationMapEntry>>
  : Record<string, Record<string, RelationMapEntry>>

/**
 * Pull the relation map for `Table`. Returns an empty record when the
 * table has no declared relations (or no augmentation present at all),
 * which makes `with` resolve to `Record<string, never>` — i.e. typing
 * a `with: { ... }` becomes a compile error per key.
 */
export type TableRelations<Table extends string> = Table extends keyof RegisteredRelations
  ? RegisteredRelations[Table] extends Record<string, RelationMapEntry>
    ? RegisteredRelations[Table]
    : Record<string, never>
  : Record<string, never>

/**
 * Kysely's `ExpressionBuilder` exposed verbatim as the second arg
 * to `where` / `orderBy` callbacks. Adopters use the callable form:
 *
 *   where:   (_u, eb) => eb('isActive', '=', true)
 *   orderBy: (_u, eb) => eb.ref('createdAt')
 *
 * Helpers like `eb.and(...)`, `eb.or(...)`, `eb.ref('col')`,
 * `eb.fn.count(...)` are Kysely's standard surface. There is no
 * `eb.eq` — that's the callable form. There is no `eb.desc` —
 * order direction lands as a separate Kysely call (e.g. wrap the
 * ref expression in `sql\`... desc\``) when needed in v1.
 */
export type QueryOps<DB, Table extends keyof DB & string> = ExpressionBuilder<DB, Table>

/**
 * The table-bound shape passed as the first arg to callbacks. The
 * declared shape is `DB[Table]`, so `u.id` resolves to the row
 * field's TS type at compile time — handy for type-narrowing in
 * adapter-side helpers. At runtime, the same `u` is a Proxy whose
 * property reads return Kysely column refs (`eb.ref('users.id')`),
 * so `eb('id', '=', u.id)` Just Works for either layer-1 or
 * relational-query call sites. Most adopters keep the first arg
 * underscored and reach for `eb('col', op, value)` directly.
 */
export type TableRefs<DB, Table extends keyof DB & string> = DB[Table]

/**
 * Options bag for `findMany` / `findFirst` / `findUnique`.
 *
 * `with` keys are constrained to the relations declared for `Table`;
 * nested `with` recursively constrains in the same way. Boolean
 * shorthand (`with: { posts: true }`) eager-loads with no
 * per-relation filtering; the object form takes a nested
 * `FindManyOptions` for the related table.
 */
export interface FindManyOptions<
  DB = RegisteredDB,
  Table extends keyof DB & string = keyof DB & string,
> {
  where?: (table: TableRefs<DB, Table>, ops: QueryOps<DB, Table>) => Expression<unknown>
  orderBy?: (
    table: TableRefs<DB, Table>,
    ops: QueryOps<DB, Table>,
  ) => Expression<unknown> | Array<Expression<unknown>>
  limit?: number
  offset?: number
  /** Override the spec's default depth guard (5). Throws `RelationalQueryDepthError` on excess. */
  maxDepth?: number
  with?: WithClause<DB, TableRelations<Table>>
}

/**
 * Per-relation shape inside `with`. `true` for boolean shorthand;
 * a nested `FindManyOptions` for filtered eager loads. Only relations
 * whose `target` is also a key of the local `DB` are accepted —
 * cross-DB relations are unrepresentable at the call site.
 */
export type WithClause<DB, Rels extends Record<string, RelationMapEntry>> = {
  [K in keyof Rels]?: Rels[K]['target'] extends keyof DB & string
    ? true | FindManyOptions<DB, Rels[K]['target']>
    : never
}

/**
 * Resolved row shape returned by `findMany`. Base table columns
 * intersected with the per-relation slot map produced by `with`.
 */
export type FindManyRow<
  DB,
  Table extends keyof DB & string,
  Opts extends FindManyOptions<DB, Table>,
> = DB[Table] & WithSlots<DB, Table, Opts['with']>

/**
 * Map each present `with` key to its resolved relation slot. Absent
 * keys do not appear in the result shape — adopters who omit `with`
 * get the bare row type back.
 */
type WithSlots<DB, Table extends keyof DB & string, W> =
  W extends Record<string, unknown>
    ? {
        [K in keyof W & keyof TableRelations<Table>]: ResolveRelationSlot<
          DB,
          TableRelations<Table>[K],
          W[K]
        >
      }
    : // eslint-disable-next-line @typescript-eslint/no-empty-object-type
      {}

/**
 * Resolve one slot. `one` returns `Related | null`; `many` returns
 * `Related[]`. Nested options recurse through `FindManyRow`.
 */
type ResolveRelationSlot<DB, R extends RelationMapEntry, V> = R['target'] extends keyof DB & string
  ? V extends true
    ? R['kind'] extends 'one'
      ? DB[R['target']] | null
      : DB[R['target']][]
    : V extends FindManyOptions<DB, R['target']>
      ? R['kind'] extends 'one'
        ? FindManyRow<DB, R['target'], V> | null
        : FindManyRow<DB, R['target'], V>[]
      : never
  : never

/**
 * Per-table query namespace exposed as `db.query.X`. v1 ships read
 * methods only — writes route through layers 1 + 2 (`selectFrom`,
 * `insertInto`, etc.).
 */
export interface TableQueryNamespace<DB, Table extends keyof DB & string> {
  findMany<O extends FindManyOptions<DB, Table>>(
    options?: O,
  ): Promise<Array<FindManyRow<DB, Table, O>>>
  findFirst<O extends FindManyOptions<DB, Table>>(
    options?: O,
  ): Promise<FindManyRow<DB, Table, O> | null>
  findUnique<O extends FindManyOptions<DB, Table>>(
    options: O,
  ): Promise<FindManyRow<DB, Table, O> | null>
}

/**
 * Top-level `db.query` namespace. One slot per table in `DB`. Defaults
 * to `RegisteredDB` so adopters using the bare `KickDbClient`
 * (relying on the `KickDbRegister` augmentation) get the right shape
 * without an explicit generic.
 */
export type QueryNamespace<DB = RegisteredDB> = {
  [Table in keyof DB & string]: TableQueryNamespace<DB, Table>
}
