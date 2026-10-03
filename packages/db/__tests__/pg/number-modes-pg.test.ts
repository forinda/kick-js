/**
 * D.24: `bigint({ mode })` and `numeric(p, s, { mode })` on Postgres, where
 * `pg` returns both as strings.
 */
import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from 'vitest'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { bigint, integer, numeric, relations, serial, table } from '@forinda/kickjs-db'
import { createPgTestDb, type PgTestDb } from '@forinda/kickjs-db/testing'

const accounts = table('accounts', {
  id: serial().primaryKey(),
  raw: bigint(),
  big: bigint({ mode: 'bigint' }),
  num: bigint({ mode: 'number' }),
  str: bigint({ mode: 'string' }),
  price: numeric(12, 2, { mode: 'number' }),
  exact: numeric(12, 2),
})
const entries = table('entries', {
  id: serial().primaryKey(),
  accountId: integer().notNull(),
  amount: numeric(12, 2, { mode: 'number' }),
})
const accountRelations = relations(accounts, ({ many }) => ({ entries: many(entries) }))
const entryRelations = relations(entries, ({ one }) => ({
  account: one(accounts, { fields: [entries.accountId], references: [accounts.id] }),
}))
const schema = { accounts, entries, accountRelations, entryRelations }

let container: StartedPostgreSqlContainer
let t: PgTestDb<typeof schema>

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  t = await createPgTestDb({ schema, connectionString: container.getConnectionUri() })
}, 120_000)
afterAll(async () => {
  await t?.drop()
  await container?.stop()
}, 60_000)

describe('number modes on Postgres', () => {
  it('reads each column as its mode asks, top level and nested', async () => {
    const big = 9007199254740993n // past 2^53
    const { id } = await t.db
      .insertInto('accounts')
      .values({ raw: big, big, num: 42n as never, str: big, price: 19.99, exact: '19.99' })
      .returning('id')
      .executeTakeFirstOrThrow()
    await t.db.insertInto('entries').values({ accountId: id, amount: 5.5 }).execute()

    const row = await t.db.selectFrom('accounts').selectAll().executeTakeFirstOrThrow()
    expect(row.raw).toBe('9007199254740993') // the driver's own value
    expect(row.big).toBe(big)
    expect(row.num).toBe(42)
    expect(row.str).toBe('9007199254740993')
    expect(row.price).toBe(19.99)
    expect(row.exact).toBe('19.99')
    expectTypeOf(row.num).toEqualTypeOf<number | null>()
    expectTypeOf(row.big).toEqualTypeOf<bigint | null>()
    expectTypeOf(row.price).toEqualTypeOf<number | null>()

    const nested = await t.db.query.accounts.findFirst({ with: { entries: true } })
    expect(nested?.entries[0].amount).toBe(5.5)
  })
})
