import type { ColumnBuilder, ColumnRef } from './columns/types'
import type { IndexDecl } from './constraints'

export type { ColumnRef }

export interface TableDecl<
  TName extends string = string,
  C extends Record<string, ColumnBuilder> = Record<string, ColumnBuilder>,
> {
  __isTable: true
  __name: TName
  __columns: C
  __indexes: IndexDecl[]
}

type TableRefs<TName extends string, C extends Record<string, ColumnBuilder>> = TableDecl<
  TName,
  C
> & {
  [K in keyof C]: ColumnRef
}

type ConstraintBuilder<C extends Record<string, ColumnBuilder>> = (refs: {
  [K in keyof C]: ColumnRef
}) => Record<string, IndexDecl>

/**
 * Declare a typed table. The `TName extends string` generic narrows to the
 * literal table name so `SchemaToKysely<S>` can index by it without losing
 * the constant — `table('users', …)` widens to `TableDecl<'users', …>`,
 * not `TableDecl<string, …>`.
 */
export function table<TName extends string, C extends Record<string, ColumnBuilder>>(
  name: TName,
  columns: C,
  constraints?: ConstraintBuilder<C>,
): TableRefs<TName, C> {
  const decl: TableDecl<TName, C> = {
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
