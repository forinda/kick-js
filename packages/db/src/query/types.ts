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
 *  2. `FindManyOptions<Table>` — the options bag accepted by
 *     `findMany` / `findFirst` / `findUnique`. `with` keys are
 *     constrained to the relations declared for `Table`; nested
 *     `with` recursively constrains in the same way.
 *
 *  3. `FindManyRow<Table, Opts>` — the resolved row shape. Base
 *     columns of `Table` plus one slot per requested `with` key,
 *     narrowed by relation kind (`one` → `Related | null`, `many` →
 *     `Related[]`).
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
 * plugin (M3.A.4) emits this alongside the column-shape augmentation.
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
 * the target table name (a key into `RegisteredDB`).
 */
export interface RelationMapEntry {
  kind: 'one' | 'many'
  target: keyof RegisteredDB & string
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
export type TableRelations<Table extends keyof RegisteredDB & string> =
  Table extends keyof RegisteredRelations
    ? RegisteredRelations[Table] extends Record<string, RelationMapEntry>
      ? RegisteredRelations[Table]
      : Record<string, never>
    : Record<string, never>

/**
 * Operator helpers exposed inside `where` / `orderBy` callbacks. v1
 * delegates to Kysely's `ExpressionBuilder` directly — `ops.eq`,
 * `ops.and`, `ops.or`, etc. are Kysely's surface verbatim.
 */
export type QueryOps<Table extends keyof RegisteredDB & string> = ExpressionBuilder<
  RegisteredDB,
  Table
>

/**
 * The table-bound shape passed as the first arg to callbacks. The row
 * shape is RegisteredDB[Table] — adopters reach for individual columns
 * via `(u, ops) => ops.eq(u.id, x)` where `u.id` is just the row
 * field's TS type. Operator-bound column references come through
 * `ops.ref('id')` for adopters who need the Kysely escape.
 */
export type TableRefs<Table extends keyof RegisteredDB & string> = RegisteredDB[Table]

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
  Table extends keyof RegisteredDB & string,
  Rels extends Record<string, RelationMapEntry> = TableRelations<Table>,
> {
  where?: (table: TableRefs<Table>, ops: QueryOps<Table>) => Expression<unknown>
  orderBy?: (
    table: TableRefs<Table>,
    ops: QueryOps<Table>,
  ) => Expression<unknown> | Array<Expression<unknown>>
  limit?: number
  offset?: number
  /** Override the spec's default depth guard (5). Throws `RelationalQueryDepthError` on excess. */
  maxDepth?: number
  /** Skip per-row `customType.fromDriver` walk on JSON-aggregated rows (spec §7 R-1). */
  raw?: boolean
  with?: WithClause<Rels>
}

/**
 * Per-relation shape inside `with`. `true` for boolean shorthand;
 * a nested `FindManyOptions` for filtered eager loads.
 */
export type WithClause<Rels extends Record<string, RelationMapEntry>> = {
  [K in keyof Rels]?: Rels[K]['target'] extends keyof RegisteredDB & string
    ? true | FindManyOptions<Rels[K]['target']>
    : never
}

/**
 * Resolved row shape returned by `findMany`. Base table columns
 * intersected with the per-relation slot map produced by `with`.
 */
export type FindManyRow<
  Table extends keyof RegisteredDB & string,
  Opts extends FindManyOptions<Table>,
> = RegisteredDB[Table] & WithSlots<Table, Opts['with']>

/**
 * Map each present `with` key to its resolved relation slot. Absent
 * keys do not appear in the result shape — adopters who omit `with`
 * get the bare row type back.
 */
type WithSlots<Table extends keyof RegisteredDB & string, W> =
  W extends Record<string, unknown>
    ? {
        [K in keyof W & keyof TableRelations<Table>]: ResolveRelationSlot<
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
type ResolveRelationSlot<R extends RelationMapEntry, V> = R['target'] extends keyof RegisteredDB &
  string
  ? V extends true
    ? R['kind'] extends 'one'
      ? RegisteredDB[R['target']] | null
      : RegisteredDB[R['target']][]
    : V extends FindManyOptions<R['target']>
      ? R['kind'] extends 'one'
        ? FindManyRow<R['target'], V> | null
        : FindManyRow<R['target'], V>[]
      : never
  : never

/**
 * Per-table query namespace exposed as `db.query.X`. v1 ships read
 * methods only — writes route through layers 1 + 2 (`selectFrom`,
 * `insertInto`, etc.).
 */
export interface TableQueryNamespace<Table extends keyof RegisteredDB & string> {
  findMany<O extends FindManyOptions<Table>>(options?: O): Promise<Array<FindManyRow<Table, O>>>
  findFirst<O extends FindManyOptions<Table>>(options?: O): Promise<FindManyRow<Table, O> | null>
  findUnique<O extends FindManyOptions<Table>>(options: O): Promise<FindManyRow<Table, O> | null>
}

/**
 * Top-level `db.query` namespace. One slot per registered table.
 */
export type QueryNamespace = {
  [Table in keyof RegisteredDB & string]: TableQueryNamespace<Table>
}
