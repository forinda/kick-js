/**
 * `db.insertMany()` on MySQL: counts rows, and refuses `returning`.
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
    await expect(db.insertMany('events', rows.slice(0, 1), { returning: true })).rejects.toThrow(
      'RETURNING',
    )
  })
})
