/**
 * Type-level helper that walks a schema barrel for `RelationsDecl`
 * entries and builds the shape the kick/db typegen plugin slots into
 * `KickDbRelationsRegister['db']`.
 *
 * The plugin emits:
 *
 *   declare module '@forinda/kickjs-db' {
 *     interface KickDbRelationsRegister {
 *       db: SchemaToRelationsRegister<typeof appSchema>
 *     }
 *   }
 *
 * — so the registry is *derived* from the schema's `relations()`
 * declarations rather than hand-mirrored. Adding or removing a
 * relation in `src/db/schema/relations.ts` flows through to call-
 * site type-checking automatically; no second file to maintain.
 *
 * Spec: docs/db/spec-relational-query.md §3.2.
 */

import type { ColumnBuilder } from '../dsl/columns/types'
import type { Relation, RelationsDecl } from '../dsl/relations'
import type { TableDecl } from '../dsl/table'
import type { RelationMapEntry } from './types'

/**
 * Distribute over `S` (the schema record), keeping only the entries
 * that are `RelationsDecl<...>`. Each entry contributes one row to
 * the output object — keyed by the source table's `__name` and
 * carrying the per-relation `{ kind, target }` map.
 *
 * `Record<string, Record<string, RelationMapEntry>>` is the
 * structural shape consumed by `KickDbRelationsRegister`; this type
 * narrows it to the literal table names present in the schema.
 */
export type SchemaToRelationsRegister<S> = MergeBySource<
  {
    [K in keyof S]: S[K] extends RelationsDecl<infer Source, infer R>
      ? Source extends string
        ? R extends Record<string, Relation>
          ? { source: Source; relations: ResolveRelations<R> }
          : never
        : never
      : never
  }[keyof S]
>

/**
 * Pull `{ kind, target }` for each relation entry. `target` shrinks
 * to the literal table name so the registry stays declarative
 * (matches the `RelationMapEntry` shape — see `query/types.ts`).
 */
type ResolveRelations<R extends Record<string, Relation>> = {
  [K in keyof R]: {
    kind: R[K]['kind']
    target: R[K]['target'] extends TableDecl<infer N, Record<string, ColumnBuilder>>
      ? N extends string
        ? N
        : string
      : string
  }
}

/**
 * Fold a union of `{ source, relations }` records into a single
 * object keyed by `source`. TypeScript distributes the conditional
 * across the union and the mapped type collects every member.
 */
type MergeBySource<U extends { source: string; relations: Record<string, RelationMapEntry> }> = {
  [Source in U['source']]: Extract<U, { source: Source }>['relations']
}
