import type { ColumnBuilder } from './columns/types'
import type { ColumnRef, TableDecl } from './table'

/**
 * Generic over the target table so the typegen plugin can pull
 * `target['__name']` without losing the literal string at the type
 * level. Existing callers that only read `kind` / `fields` /
 * `references` see the same surface.
 */
export interface RelationOne<
  TTarget extends TableDecl<string, Record<string, ColumnBuilder>> = TableDecl<
    string,
    Record<string, ColumnBuilder>
  >,
> {
  kind: 'one'
  target: TTarget
  fields: ColumnRef[]
  references: ColumnRef[]
  /**
   * Disambiguates this relation from sibling `one` relations on the
   * same source table that point at the same target. Pair with the
   * matching `relationName` on the inverse `many` side. See
   * docs/db/spec-relation-name.md.
   */
  relationName?: string
}

export interface RelationMany<
  TTarget extends TableDecl<string, Record<string, ColumnBuilder>> = TableDecl<
    string,
    Record<string, ColumnBuilder>
  >,
> {
  kind: 'many'
  target: TTarget
  /**
   * Pairs with the matching `relationName` on the inverse `one`
   * declaration. Required when the source table has multiple FKs
   * to the same target; resolver throws
   * `RelationalQueryMissingInverseError` otherwise.
   */
  relationName?: string
}

export type Relation = RelationOne | RelationMany

/**
 * Generic so the typegen plugin can read the source table name and
 * the per-relation kind/target via `RelationsDecl['__sourceTable']`
 * and `RelationsDecl['__relations']`. The runtime shape is
 * unchanged; the generic parameters narrow the type at call sites.
 */
export interface RelationsDecl<
  TSource extends string = string,
  TRelations extends Record<string, Relation> = Record<string, Relation>,
> {
  __isRelations: true
  __sourceTable: TSource
  __relations: TRelations
}

interface Helpers {
  one: <T extends TableDecl<string, Record<string, ColumnBuilder>>>(
    target: T,
    opts: { fields: ColumnRef[]; references: ColumnRef[]; relationName?: string },
  ) => RelationOne<T>
  many: <T extends TableDecl<string, Record<string, ColumnBuilder>>>(
    target: T,
    opts?: { relationName?: string },
  ) => RelationMany<T>
}

/**
 * Declare a typed relation set for `source`. The return type
 * preserves `source.__name` and the literal `kind`/`target` of every
 * helper-built entry so `SchemaToRelationsRegister<S>` (re-exported
 * from `@forinda/kickjs-db`) can walk the schema barrel and emit a
 * matching `KickDbRelationsRegister` augmentation at typegen time.
 */
export function relations<
  T extends TableDecl<string, Record<string, ColumnBuilder>>,
  R extends Record<string, Relation>,
>(source: T, builder: (h: Helpers) => R): RelationsDecl<T['__name'], R> {
  const helpers: Helpers = {
    one: (target, opts) => ({
      kind: 'one',
      target,
      fields: opts.fields,
      references: opts.references,
      ...(opts.relationName !== undefined ? { relationName: opts.relationName } : {}),
    }),
    many: (target, opts) => ({
      kind: 'many',
      target,
      ...(opts?.relationName !== undefined ? { relationName: opts.relationName } : {}),
    }),
  }
  return {
    __isRelations: true,
    __sourceTable: source.__name,
    __relations: builder(helpers),
  } as RelationsDecl<T['__name'], R>
}
