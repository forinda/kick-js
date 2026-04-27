import type { ColumnBuilder } from './columns/types'
import type { IndexDecl } from './constraints'

export interface ColumnRef {
  __tableName: string
  __name: string
  __builder: ColumnBuilder
  __state: () => ReturnType<ColumnBuilder['__state']>
}

export interface TableDecl<
  C extends Record<string, ColumnBuilder> = Record<string, ColumnBuilder>,
> {
  __isTable: true
  __name: string
  __columns: C
  __indexes: IndexDecl[]
}

type TableRefs<C extends Record<string, ColumnBuilder>> = TableDecl<C> & {
  [K in keyof C]: ColumnRef
}

type ConstraintBuilder<C extends Record<string, ColumnBuilder>> = (refs: {
  [K in keyof C]: ColumnRef
}) => Record<string, IndexDecl>

export function table<C extends Record<string, ColumnBuilder>>(
  name: string,
  columns: C,
  constraints?: ConstraintBuilder<C>,
): TableRefs<C> {
  const decl: TableDecl<C> = {
    __isTable: true,
    __name: name,
    __columns: columns,
    __indexes: [],
  }

  const refs = {} as { [K in keyof C]: ColumnRef }
  for (const [key, builder] of Object.entries(columns) as [keyof C, ColumnBuilder][]) {
    refs[key] = {
      __tableName: name,
      __name: key as string,
      __builder: builder,
      __state: () => builder.__state(),
    }
  }

  if (constraints) {
    const declared = constraints(refs)
    decl.__indexes = Object.values(declared)
  }

  return Object.assign(decl, refs)
}
