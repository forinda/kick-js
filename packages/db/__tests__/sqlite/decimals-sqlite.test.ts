/**
 * Decimals on SQLite: `decimal()` / `numeric()` / `money()` are typed
 * `string`, so they read back as a string at the column's scale — the same
 * value Postgres and MySQL return — though SQLite stores a float.
 */
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  createDbClient,
  decimal,
  diff,
  emitSqlite,
  extractSnapshot,
  numeric,
  serial,
  table,
} from '@forinda/kickjs-db'
import { money } from '@forinda/kickjs-db/pg'
import { sqliteDialect } from '@forinda/kickjs-db/sqlite'

const prices = table('prices', {
  id: serial().primaryKey(),
  amount: decimal(12, 2).notNull(),
  whole: numeric(10),
  ratio: numeric(),
  fee: money(),
})
const schema = { prices }

function make() {
  const database = new Database(':memory:')
  const empty = { version: 1 as const, dialect: 'sqlite' as const, tables: {} }
  const target = extractSnapshot(schema, 'sqlite')
  database.exec(emitSqlite(diff(empty, target), { from: empty, to: target }))
  return createDbClient({ schema, dialect: sqliteDialect({ database }) })
}

describe('decimals on SQLite', () => {
  it('read back as strings at the column scale', async () => {
    const db = make()
    await db
      .insertInto('prices')
      .values({ amount: '0.10', whole: '42', ratio: '0.125', fee: '3.5' })
      .execute()
    await db.insertInto('prices').values({ amount: '1234567890.12' }).execute()

    const rows = await db.selectFrom('prices').selectAll().orderBy('id').execute()
    expect(rows).toEqual([
      { id: 1, amount: '0.10', whole: '42', ratio: '0.125', fee: '3.50' },
      { id: 2, amount: '1234567890.12', whole: null, ratio: null, fee: null },
    ])
  })

  it('compare and sort as numbers', async () => {
    const db = make()
    for (const amount of ['9.50', '10.00', '100.25']) {
      await db.insertInto('prices').values({ amount }).execute()
    }
    const rows = await db
      .selectFrom('prices')
      .select('amount')
      .where('amount', '>', '9.99')
      .orderBy('amount')
      .execute()
    expect(rows.map((r) => r.amount)).toEqual(['10.00', '100.25'])
  })
})
