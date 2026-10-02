import { sql, type Expression } from 'kysely'

/**
 * Sort direction for a relational `orderBy`, which takes expressions:
 *
 *   orderBy: (p, eb) => desc(eb.ref('publishedAt'))
 *   orderBy: (p, eb) => [desc(eb.ref('priority')), asc(eb.ref('title'))]
 *
 * Works at the top level and inside `with`, on every dialect.
 */
export function desc<T>(expression: Expression<T>): Expression<T> {
  return sql<T>`${expression} desc`
}

/** Ascending order — the default, spelled out. See {@link desc}. */
export function asc<T>(expression: Expression<T>): Expression<T> {
  return sql<T>`${expression} asc`
}
