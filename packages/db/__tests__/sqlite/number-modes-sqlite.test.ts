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
