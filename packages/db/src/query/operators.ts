/**
 * Standalone condition helpers — `eq(users.email, x)`, `and(…)`, `or(…)` —
 * for anyone who prefers them to Kysely's `eb('col', '=', x)`. Each returns
 * a Kysely `Expression<SqlBool>`, so it goes wherever one is taken:
 * `.where(…)`, `.on(…)` in a join, `having`, and `db.query`'s `where`.
 *
 * An operand is one of:
 *   - a column of a schema table (`users.email`) or of an `alias()`;
 *   - the row argument of a `db.query` callback (`(u) => eq(u.email, x)`);
 *   - any Kysely expression (`eb.ref('email')`, `sql\`lower(email)\``);
 *   - otherwise a value, sent as a bound parameter.
 */
import { sql, type Expression, type RawBuilder, type SelectType, type SqlBool } from 'kysely'
import type { ColumnRef, TypedColumnRef } from '../dsl/columns/types'

/** The value type an operand stands for. */
type ValueOf<O> = O extends TypedColumnRef<infer T> ? T : O extends Expression<infer T> ? T : O

/** What may sit across from `O`: a value of its type, or anything standing for one. */
type Comparable<O> = Operand<SelectType<ValueOf<O>>>

/** A column, a Kysely expression, or a value. */
export type Operand<T = unknown> = TypedColumnRef<T> | Expression<T> | T

type Condition = RawBuilder<SqlBool>

function isExpression(value: unknown): value is Expression<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { toOperationNode?: unknown }).toOperationNode === 'function'
  )
}

function isColumnRef(value: unknown): value is ColumnRef {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ColumnRef).__tableName === 'string' &&
    typeof (value as ColumnRef).__name === 'string'
  )
}

/** An operand as SQL: a qualified column reference, the expression itself, or a parameter. */
function toSql(operand: unknown): Expression<unknown> {
  if (isExpression(operand)) return operand
  if (isColumnRef(operand)) return sql.ref(`${operand.__tableName}.${operand.__name}`)
  return sql.val(operand)
}

function binary(op: string) {
  return <L>(left: L, right: Comparable<L>): Condition =>
    sql<SqlBool>`${toSql(left)} ${sql.raw(op)} ${toSql(right)}`
}

export const eq = binary('=')
export const ne = binary('<>')
export const gt = binary('>')
export const gte = binary('>=')
export const lt = binary('<')
export const lte = binary('<=')

/** `left LIKE pattern` — escape user input with `escapeLike()`. */
export const like = <L>(left: L, pattern: Operand<string>): Condition =>
  sql<SqlBool>`${toSql(left)} like ${toSql(pattern)}`
export const notLike = <L>(left: L, pattern: Operand<string>): Condition =>
  sql<SqlBool>`${toSql(left)} not like ${toSql(pattern)}`
/** Case-insensitive `LIKE` (Postgres). */
export const ilike = <L>(left: L, pattern: Operand<string>): Condition =>
  sql<SqlBool>`${toSql(left)} ilike ${toSql(pattern)}`

export const isNull = (operand: unknown): Condition => sql<SqlBool>`${toSql(operand)} is null`
export const isNotNull = (operand: unknown): Condition =>
  sql<SqlBool>`${toSql(operand)} is not null`

/** `left IN (…)`. An empty list matches nothing, rather than being invalid SQL. */
export function inArray<L>(left: L, values: readonly Comparable<L>[]): Condition {
  if (values.length === 0) return sql<SqlBool>`1 = 0`
  return sql<SqlBool>`${toSql(left)} in (${sql.join(values.map(toSql))})`
}

/** `left NOT IN (…)`. An empty list matches everything. */
export function notInArray<L>(left: L, values: readonly Comparable<L>[]): Condition {
  if (values.length === 0) return sql<SqlBool>`1 = 1`
  return sql<SqlBool>`${toSql(left)} not in (${sql.join(values.map(toSql))})`
}

export const between = <L>(left: L, low: Comparable<L>, high: Comparable<L>): Condition =>
  sql<SqlBool>`${toSql(left)} between ${toSql(low)} and ${toSql(high)}`

/**
 * All of the conditions. `undefined` entries are skipped, so a filter can be
 * built conditionally: `and(eq(t.a, a), b ? eq(t.b, b) : undefined)`. With
 * none left it matches every row.
 */
export function and(...conditions: (Expression<SqlBool> | undefined)[]): Condition {
  return combine(conditions, 'and', sql<SqlBool>`1 = 1`)
}

/** Any of the conditions; `undefined` entries are skipped. With none left it matches no row. */
export function or(...conditions: (Expression<SqlBool> | undefined)[]): Condition {
  return combine(conditions, 'or', sql<SqlBool>`1 = 0`)
}

function combine(
  conditions: (Expression<SqlBool> | undefined)[],
  op: 'and' | 'or',
  empty: Condition,
): Condition {
  const present = conditions.filter((c): c is Expression<SqlBool> => c !== undefined)
  if (present.length === 0) return empty
  return sql<SqlBool>`(${sql.join(present, sql.raw(` ${op} `))})`
}

export const not = (condition: Expression<SqlBool>): Condition => sql<SqlBool>`not (${condition})`

/** `EXISTS (subquery)` — pass a Kysely select; it brings its own parentheses. */
export const exists = (subquery: Expression<unknown>): Condition => sql<SqlBool>`exists ${subquery}`
export const notExists = (subquery: Expression<unknown>): Condition =>
  sql<SqlBool>`not exists ${subquery}`
