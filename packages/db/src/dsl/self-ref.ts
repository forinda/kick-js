import type { ColumnBuilder, ColumnRef } from './columns/types'

const SELF = Symbol.for('@forinda/kickjs-db/self-ref')

/**
 * A foreign key to a column of the table being declared. The table binds it
 * to its own column once it exists; a name that isn't a column fails there.
 *
 * Writing `() => categories.id` instead makes the const's type depend on its
 * own initializer, which TypeScript rejects (TS7022) unless the thunk is
 * annotated `(): ColumnRef => categories.id`. Tables that point at each other
 * use `link()`.
 *
 * @example
 * const categories = table('categories', {
 *   id: uuid().primaryKey().defaultRandom(),
 *   parentId: uuid().references(selfRef('id'), { onDelete: 'set_null' }),
 * })
 */
export function selfRef(column: string): () => ColumnRef {
  const thunk = () => {
    throw new Error(`selfRef('${column}') is not bound to a table`)
  }
  return Object.assign(thunk, { [SELF]: column })
}

/**
 * The columns a table is built from, with each `selfRef(...)` resolved to
 * THIS table's column.
 *
 * The caller's builders are never mutated: a column carrying a self-reference
 * is copied, and the copy is bound. A builder shared by two tables
 * (`const parent = uuid().references(selfRef('id'))`) therefore points each
 * one at itself, and a table that fails to build leaves nothing bound. Every
 * target is checked before anything is copied.
 *
 * `refs` is filled in by the caller once the table's refs exist; the bound
 * thunks read it lazily, at snapshot time.
 */
export function resolveSelfRefs<C extends Record<string, ColumnBuilder>>(
  tableName: string,
  columns: C,
  refs: Record<string, ColumnRef>,
): C {
  const targets: Array<[key: string, target: string]> = []
  for (const [key, builder] of Object.entries(columns)) {
    const thunk = builder.__state().references?.thunk as
      | ((() => ColumnRef) & { [SELF]?: string })
      | undefined
    const target = thunk?.[SELF]
    if (target === undefined) continue
    // Own keys only: `in` would accept inherited names like `constructor`.
    if (!Object.hasOwn(columns, target)) {
      throw new Error(`selfRef('${target}'): table '${tableName}' has no column '${target}'`)
    }
    targets.push([key, target])
  }
  if (targets.length === 0) return columns

  const resolved: Record<string, ColumnBuilder> = { ...columns }
  for (const [key, target] of targets) {
    const original = columns[key]!
    const copy = Object.assign(
      Object.create(Object.getPrototypeOf(original)),
      original,
    ) as ColumnBuilder
    const state = original.__state()
    ;(copy as unknown as { state: unknown }).state = {
      ...state,
      references: { ...state.references!, thunk: () => refs[target]! },
    }
    resolved[key] = copy
  }
  return resolved as C
}
