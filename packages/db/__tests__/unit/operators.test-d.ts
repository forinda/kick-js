/** Types for the condition helpers, alias() and reusable CTEs. */
import { expectTypeOf, test } from 'vitest'
import type { SqlBool, Expression } from 'kysely'
import {
  alias,
  and,
  eq,
  inArray,
  integer,
  serial,
  table,
  text,
  type KickDbClient,
  type SchemaToTypes,
} from '@forinda/kickjs-db'

const users = table('users', {
  id: serial().primaryKey(),
  name: text().notNull(),
  managerId: integer(),
})
type DB = SchemaToTypes<{ users: typeof users }>
declare const db: KickDbClient<DB>

test('operands are checked against the column type', () => {
  expectTypeOf(eq(users.name, 'Ada')).toMatchTypeOf<Expression<SqlBool>>()
  // @ts-expect-error a number is not a name
  eq(users.name, 1)
  // @ts-expect-error inArray takes values of the column type
  inArray(users.id, ['1'])
  expectTypeOf(and(eq(users.id, 1), undefined)).toMatchTypeOf<Expression<SqlBool>>()
})

test("db.query's row argument works as an operand, generated columns included", () => {
  void db.query.users.findMany({ where: (u) => and(eq(u.id, 1), eq(u.name, 'Ada')) })
  // @ts-expect-error id is a number
  void db.query.users.findMany({ where: (u) => eq(u.id, 'x') })
})

test('alias() keeps the column types and names the join source', () => {
  const manager = alias(users, 'manager')
  expectTypeOf(manager.$from).toEqualTypeOf<'users as manager'>()
  // @ts-expect-error a string is not an id
  eq(manager.id, 'x')
})

test('a reusable CTE types the queries that use it', () => {
  const named = db.cte('named', (q) => q.selectFrom('users').select(['id', 'name']))
  const query = db
    .with(...named)
    .selectFrom('named')
    .select(['named.name'])
  expectTypeOf<Awaited<ReturnType<typeof query.executeTakeFirstOrThrow>>>().toEqualTypeOf<{
    name: string
  }>()
})
