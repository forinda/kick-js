import type { ColumnBuilder, ColumnRef } from './columns/types'

/**
 * `parentId: uuid().references(() => categories.id)` inside `table(...)` is
 * TS7022: the const's type depends on its own initializer. The usual fix —
 * `(): ColumnRef => categories.id` — is the step people don't know about.
 * `selfRef('id')` names the column instead of reaching for the const; the
 * table binds it to its own column once it exists.
 *
 *   const categories = table('categories', {
 *     id: uuid().primaryKey(),
 *     parentId: uuid().references(selfRef('id')),
 *   })
 */
const SELF = Symbol.for('@forinda/kickjs-db/self-ref')

export function selfRef(column: string): () => ColumnRef {
  const thunk = () => {
    throw new Error(`selfRef('${column}') is not bound to a table`)
  }
  return Object.assign(thunk, { [SELF]: column })
}

/** Point each `selfRef(...)` among `columns` at the matching ref. */
export function bindSelfRefs(
  tableName: string,
  columns: Record<string, ColumnBuilder>,
  refs: Record<string, ColumnRef>,
): void {
  for (const builder of Object.values(columns)) {
    const spec = builder.__state().references as {
      thunk: (() => ColumnRef) & { [SELF]?: string }
    } | null
    const target = spec?.thunk[SELF]
    if (target === undefined) continue
    if (!(target in columns)) {
      throw new Error(`selfRef('${target}'): table '${tableName}' has no column '${target}'`)
    }
    spec!.thunk = () => refs[target]!
  }
}
