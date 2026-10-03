/** D.24: `bigint({ mode })` and `numeric(p, s, { mode })` on SQLite. */
import { expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  bigint,
  createDbClient,
  diff,
  emitSqlite,
  extractSnapshot,
  numeric,
  serial,
  table,
} from '@forinda/kickjs-db'
import { sqliteDialect } from '@forinda/kickjs-db/sqlite'

const accounts = table('accounts', {
  id: serial().primaryKey(),
  big: bigint({ mode: 'bigint' }),
  str: bigint({ mode: 'string' }),
  price: numeric(12, 2, { mode: 'number' }),
})
const schema = { accounts }

it('reads each column as its mode asks', async () => {
  const database = new Database(':memory:')
  const empty = { version: 1 as const, dialect: 'sqlite' as const, tables: {} }
  const target = extractSnapshot(schema, 'sqlite')
  database.exec(emitSqlite(diff(empty, target), { from: empty, to: target }))
  const db = createDbClient({ schema, dialect: sqliteDialect({ database }) })
  await db
    .insertInto('accounts')
    .values({ big: 7n, str: 8n as never, price: 1.5 })
    .execute()
  expect(
    await db.selectFrom('accounts').select(['big', 'str', 'price']).executeTakeFirst(),
  ).toEqual({
    big: 7n,
    str: '8',
    price: 1.5,
  })
})

it("refuses a value a number can't hold, under mode 'number'", async () => {
  const { insertSchema } = await import('@forinda/kickjs-db/schema')
  const t = table('t', { id: serial().primaryKey(), n: bigint({ mode: 'number' }) })
  const schema = insertSchema(t)
  expect(schema.safeParse({ n: '9007199254740991' })).toMatchObject({
    success: true,
    data: { n: 9007199254740991 },
  })
  expect(schema.safeParse({ n: '9007199254740993' }).success).toBe(false)
})

it("refuses a decimal a number can't hold exactly, under mode 'number'", async () => {
  const { insertSchema } = await import('@forinda/kickjs-db/schema')
  const t = table('t', { id: serial().primaryKey(), price: numeric(20, 2, { mode: 'number' }) })
  const schema = insertSchema(t)
  expect(schema.safeParse({ price: '1234567890123.45' })).toMatchObject({
    success: true,
    data: { price: 1234567890123.45 },
  })
  expect(schema.safeParse({ price: '0.10' })).toMatchObject({ success: true, data: { price: 0.1 } })
  expect(schema.safeParse({ price: '12345678901234567.89' }).success).toBe(false)
})
