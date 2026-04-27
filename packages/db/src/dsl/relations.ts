import type { TableDecl, ColumnRef } from './table'
import type { ColumnBuilder } from './columns/types'

export interface RelationOne {
  kind: 'one'
  target: TableDecl<Record<string, ColumnBuilder>>
  fields: ColumnRef[]
  references: ColumnRef[]
}

export interface RelationMany {
  kind: 'many'
  target: TableDecl<Record<string, ColumnBuilder>>
}

export type Relation = RelationOne | RelationMany

export interface RelationsDecl {
  __isRelations: true
  __sourceTable: string
  __relations: Record<string, Relation>
}

interface Helpers {
  one: (
    target: TableDecl<Record<string, ColumnBuilder>>,
    opts: { fields: ColumnRef[]; references: ColumnRef[] },
  ) => RelationOne
  many: (target: TableDecl<Record<string, ColumnBuilder>>) => RelationMany
}

export function relations<T extends TableDecl<Record<string, ColumnBuilder>>>(
  source: T,
  builder: (h: Helpers) => Record<string, Relation>,
): RelationsDecl {
  const helpers: Helpers = {
    one: (target, opts) => ({
      kind: 'one',
      target,
      fields: opts.fields,
      references: opts.references,
    }),
    many: (target) => ({ kind: 'many', target }),
  }
  return {
    __isRelations: true,
    __sourceTable: source.__name,
    __relations: builder(helpers),
  }
}
