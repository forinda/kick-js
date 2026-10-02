/** D.20 on MySQL 8: a generated column computes and can't be written. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql'
import { createPool, type Pool } from 'mysql2/promise'
import {
  checkDrift,
  diff,
  emitMysql,
  extractSnapshot,
  integer,
  introspectMysql,
  serial,
  table,
} from '@forinda/kickjs-db'

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
