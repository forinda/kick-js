/**
 * `db.insertMany()` on MySQL: counts rows, and returns them through `readBack`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql'
import { createPool, type Pool } from 'mysql2/promise'
import {
  createDbClient,
  diff,
  emitMysql,
  extractSnapshot,
  integer,
  serial,
  table,
  text,
  varchar,
} from '@forinda/kickjs-db'
import { mysqlDialect } from '@forinda/kickjs-db/mysql'

const events = table('events', {
  id: serial().primaryKey(),
  code: varchar(64).notNull().unique(),
  kind: text().notNull(),
  weight: integer().notNull(),
})
const schema = { events }

let container: StartedMySqlContainer
let pool: Pool

beforeAll(async () => {
  container = await new MySqlContainer('mysql:8.0').start()
  pool = createPool({
    host: container.getHost(),
    port: container.getPort(),
    user: 'root',
    password: container.getRootPassword(),
    database: container.getDatabase(),
    multipleStatements: true,
  })
  const empty = { version: 1 as const, dialect: 'mysql' as const, tables: {} }
  await pool.query(emitMysql(diff(empty, extractSnapshot(schema, 'mysql'))))
}, 180_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
}, 60_000)

describe('insertMany on MySQL', () => {
  it('inserts 25,000 rows in statements under the limit, and counts them', async () => {
    const db = createDbClient({ schema, dialect: mysqlDialect({ pool }) })
    const rows = Array.from({ length: 25_000 }, (_, i) => ({
      code: `e-${i}`,
      kind: 'k',
      weight: i,
    }))
    expect(await db.insertMany('events', rows)).toBe(25_000)
  }, 120_000)

  it('returns the rows through readBack, in input order, and says how without it', async () => {
    const db = createDbClient({ schema, dialect: mysqlDialect({ pool }) })
    // Enough rows for more than one statement under a small parameter limit.
    const rows = ['r-3', 'r-1', 'r-2', 'r-5', 'r-4'].map((code, i) => ({
      code,
      kind: 'k',
      weight: i,
    }))
    const stored = await db.insertMany('events', rows, {
      returning: true,
      readBack: ['code'],
      maxParams: 6,
    })
    expect(stored.map((r) => r.code)).toEqual(['r-3', 'r-1', 'r-2', 'r-5', 'r-4'])
    expect(stored.every((r) => typeof r.id === 'number' && r.id > 0)).toBe(true)

    await expect(
      db.insertMany('events', [{ code: 'x', kind: 'k', weight: 0 }], { returning: true }),
    ).rejects.toThrow(/needs readBack .* readBack: \['email'\]/)
    // A key that isn't unique: the insert rolls back.
    await expect(
      db.insertMany('events', [{ code: 'dup-kind', kind: 'k', weight: 0 }], {
        returning: true,
        readBack: ['kind'],
      }),
    ).rejects.toThrow(/readBack has to be a unique key/)
    const left = await db
      .selectFrom('events')
      .select('code')
      .where('code', '=', 'dup-kind')
      .execute()
    expect(left).toEqual([])
  }, 60_000)
})
