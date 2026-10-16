/** D.20 on MySQL 8: a generated column computes and can't be written. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql'
import { createPool, type Pool } from 'mysql2/promise'
import {
  checkDrift,
  createDbClient,
  diff,
  emitMysql,
  extractSnapshot,
  integer,
  introspectMysql,
  serial,
  table,
} from '@forinda/kickjs-db'
import { mysqlDialect } from '@forinda/kickjs-db/mysql'
import { sql } from 'kysely'

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
}, 180_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
}, 60_000)

describe('generated columns on MySQL', () => {
  it('computes them and refuses writes', async () => {
    const target = extractSnapshot(
      {
        t: table('t', {
          id: serial().primaryKey(),
          a: integer().notNull(),
          twice: integer().generatedAlwaysAs('a * 2'),
          thrice: integer().generatedAlwaysAs('a * 3', { stored: false }),
        }),
      },
      'mysql',
    )
    await pool.query(emitMysql(diff({ version: 1, dialect: 'mysql', tables: {} }, target)))
    await pool.query('INSERT INTO t (a) VALUES (5)')
    const [rows] = await pool.query('SELECT a, twice, thrice FROM t')
    expect(rows).toEqual([{ a: 5, twice: 10, thrice: 15 }])
    await expect(pool.query('INSERT INTO t (a, twice) VALUES (1, 1)')).rejects.toThrow(
      /generated column/,
    )
    await expect(checkDrift(await introspectMysql(pool), target, 'error')).resolves.toBeUndefined()
  }, 60_000)
})

describe('db.timeout() on MySQL', () => {
  it('kills the query on the server', async () => {
    const db = createDbClient({ schema: {}, dialect: mysqlDialect({ pool }) })
    const start = Date.now()
    await expect(
      db.qb.selectNoFrom(sql<number>`sleep(10)`.as('slept')).execute(db.timeout(100)),
    ).rejects.toMatchObject({ name: 'TimeoutError' })
    expect(Date.now() - start).toBeLessThan(3_000)
    const running = async () => {
      const [rows] = (await pool.query(
        `SELECT count(*) AS n FROM information_schema.processlist
            WHERE command = 'Query' AND id <> CONNECTION_ID() AND info LIKE '%sleep(10)%'`,
      )) as [Array<{ n: number }>, unknown]
      return Number(rows[0]!.n)
    }
    const until = Date.now() + 2_000
    while ((await running()) > 0 && Date.now() < until) await new Promise((r) => setTimeout(r, 50))
    expect(await running()).toBe(0)
  }, 30_000)
})
