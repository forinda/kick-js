/** D.20 on MySQL 8: a generated column computes and can't be written. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql'
import { createPool, type Pool } from 'mysql2/promise'
import {
  checkDrift,
  diff,
  emitMysql,
  extractSnapshot,
  bigSerial,
  integer,
  introspectMysql,
  jsonb,
  serial,
  table,
  text,
  varchar,
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

describe('defaults and serial keys on MySQL', () => {
  it('runs expression, TEXT/JSON and escaped defaults, and keeps AUTO_INCREMENT through MODIFY', async () => {
    const empty = { version: 1 as const, dialect: 'mysql' as const, tables: {} }
    const columns = {
      token: varchar(36).default('uuid()'),
      doc: jsonb().notNull().default('{}'),
      body: text().notNull().default('0800'),
      path: varchar(20).notNull().default('C:\\temp'),
    }
    const before = extractSnapshot(
      { d: table('d', { id: serial().primaryKey(), ...columns }) },
      'mysql',
    )
    await pool.query(emitMysql(diff(empty, before)))
    await pool.query('INSERT INTO d () VALUES ()')
    const [rows] = (await pool.query('SELECT token, doc, body, path FROM d')) as [any[], unknown]
    expect(rows[0].token).toMatch(/^[0-9a-f-]{36}$/)
    expect({ ...rows[0], token: undefined }).toEqual({
      token: undefined,
      doc: {},
      body: '0800',
      path: 'C:\\temp',
    })
    // serial → bigSerial is a MODIFY; inserts still get an id.
    const after = extractSnapshot(
      { d: table('d', { id: bigSerial().primaryKey(), ...columns }) },
      'mysql',
    )
    await pool.query(emitMysql(diff(before, after)))
    await pool.query('INSERT INTO d () VALUES ()')
    const [ids] = await pool.query('SELECT id FROM d ORDER BY id')
    expect((ids as Array<{ id: number }>).map((r) => Number(r.id))).toEqual([1, 2])
  }, 60_000)
})
