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
 *
 * At least one operand must be a column or an expression. A string is a value,
 * not a column name — `eq('id', id)` would compare the text `'id'` — so two
 * values fail to compile, and throw when the types are bypassed.
 */
import { sql, type Expression, type RawBuilder, type SelectType, type SqlBool } from 'kysely'
import type { ColumnRef, TypedColumnRef } from '../dsl/columns/types'

/** The value type an operand stands for. */
type ValueOf<O> = O extends TypedColumnRef<infer T> ? T : O extends Expression<infer T> ? T : O

/** What may sit across from `O`: a value of its type, or anything standing for one. */
type Comparable<O> = Operand<SelectType<ValueOf<O>>>

/** A column, a Kysely expression, or a value. */
export type Operand<T = unknown> = TypedColumnRef<T> | Expression<T> | T

/** A column or an expression — anything but a plain value. */
type Ref<T = any> = TypedColumnRef<T> | Expression<T>

/** What may sit across from `L`: anything comparable, but only a column or expression across from a value. */
type Across<L> = [L] extends [TypedColumnRef<any> | Expression<any>]
  ? Comparable<L>
  : Ref<SelectType<ValueOf<L>>>

/** The list across from `L`: with a value on the left, a non-empty list of columns or expressions. */
type AcrossList<L> = [L] extends [TypedColumnRef<any> | Expression<any>]
  ? readonly Comparable<L>[]
  : readonly [Across<L>, ...Across<L>[]]

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

function isRef(operand: unknown): boolean {
  return isExpression(operand) || isColumnRef(operand)
}

/** Throws when no operand is a column or an expression — a comparison of values. */
function assertRef(helper: string, ...operands: unknown[]): void {
  if (operands.some(isRef)) return
  throw new TypeError(
    `${helper}() got only values — one side must be a column (\`users.email\`) or an expression. ` +
      `A string is a value, not a column name: write \`.where('email', '=', x)\` to name a column.`,
  )
}

/** An operand as SQL: a qualified column reference, the expression itself, or a parameter. */
function toSql(operand: unknown): Expression<unknown> {
  if (isExpression(operand)) return operand
  if (isColumnRef(operand)) return sql.ref(`${operand.__tableName}.${operand.__name}`)
  return sql.val(operand)
}

function binary(name: string, op: string) {
  return <L>(left: L, right: Across<L>): Condition => {
    assertRef(name, left, right)
    return sql<SqlBool>`${toSql(left)} ${sql.raw(op)} ${toSql(right)}`
  }
}

export const eq = binary('eq', '=')
export const ne = binary('ne', '<>')
export const gt = binary('gt', '>')
export const gte = binary('gte', '>=')
export const lt = binary('lt', '<')
export const lte = binary('lte', '<=')

function likeOp(name: string, op: string) {
  return <L>(left: L, pattern: [L] extends [Ref] ? Operand<string> : Ref<string>): Condition => {
    assertRef(name, left, pattern)
    return sql<SqlBool>`${toSql(left)} ${sql.raw(op)} ${toSql(pattern)}`
  }
}

/** `left LIKE pattern` — escape user input with `escapeLike()`. */
export const like = likeOp('like', 'like')
export const notLike = likeOp('notLike', 'not like')
/** Case-insensitive `LIKE` (Postgres). */
export const ilike = likeOp('ilike', 'ilike')

export const isNull = (operand: Ref | ColumnRef): Condition => {
  assertRef('isNull', operand)
  return sql<SqlBool>`${toSql(operand)} is null`
}
export const isNotNull = (operand: Ref | ColumnRef): Condition => {
  assertRef('isNotNull', operand)
  return sql<SqlBool>`${toSql(operand)} is not null`
}

/**
 * `left IN (…)`. An empty list matches nothing, rather than being invalid SQL.
 * `L` is read from `left` only: inside `and()` / `or()` a `string[]` list would
 * otherwise win and reject the column (`TypedColumnRef<string>` vs `string`).
 */
export function inArray<L>(left: L, values: AcrossList<NoInfer<L>>): Condition {
  assertRef('inArray', left, ...values)
  if (values.length === 0) return sql<SqlBool>`1 = 0`
  return sql<SqlBool>`${toSql(left)} in (${sql.join(values.map(toSql))})`
}

/** `left NOT IN (…)`. An empty list matches everything. */
export function notInArray<L>(left: L, values: AcrossList<NoInfer<L>>): Condition {
  assertRef('notInArray', left, ...values)
  if (values.length === 0) return sql<SqlBool>`1 = 1`
  return sql<SqlBool>`${toSql(left)} not in (${sql.join(values.map(toSql))})`
}

/** With a value on the left, `low` must be a column or an expression. */
export const between = <L>(left: L, low: Across<L>, high: Comparable<L>): Condition => {
  assertRef('between', left, low, high)
  return sql<SqlBool>`${toSql(left)} between ${toSql(low)} and ${toSql(high)}`
}

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
