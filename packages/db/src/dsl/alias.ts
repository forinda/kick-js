import type { ColumnBuilder, TypedColumnRefs } from './columns/types'
import { qualifiedTableName, type TableDecl } from './table'

type Qualified<TName extends string, TSchema> = TSchema extends string
  ? `${TSchema}.${TName}`
  : TName

/** A table under a second name: its columns, plus `$from` for `selectFrom` / joins. */
export type AliasedTable<
  TName extends string,
  C extends Record<string, ColumnBuilder>,
  TSchema extends string | undefined,
  A extends string,
> = TypedColumnRefs<C> & {
  /** `'<table> as <alias>'` — what `selectFrom` and the joins take. */
  readonly $from: `${Qualified<TName, TSchema>} as ${A}`
}

/**
 * The same table under another name, for self-joins and reading a table twice.
 * Its columns work with the condition helpers:
 *
 *   const manager = alias(users, 'manager')
 *   db.selectFrom('users')
 *     .innerJoin(manager.$from, (j) => j.on(eq(manager.id, users.managerId)))
 *     .select(['users.name', 'manager.name as managerName'])
 */
export function alias<
  TName extends string,
  C extends Record<string, ColumnBuilder>,
  TSchema extends string | undefined,
  A extends string,
>(table: TableDecl<TName, C, TSchema>, name: A): AliasedTable<TName, C, TSchema, A> {
  const refs: Record<string, unknown> = {}
  for (const [key, builder] of Object.entries(table.__columns)) {
    refs[key] = {
      __tableName: name,
      __name: key,
      __builder: builder,
      __state: () => builder.__state(),
    }
  }
  refs.$from = `${qualifiedTableName(table)} as ${name}`
  return refs as AliasedTable<TName, C, TSchema, A>
}
