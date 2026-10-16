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
  bigSerial,
  integer,
  introspectMysql,
  jsonb,
  serial,
  table,
  text,
  timestamp,
  varchar,
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

describe('defaults and serial keys on MySQL', () => {
  it('runs expression, TEXT/JSON and escaped defaults, and keeps AUTO_INCREMENT through MODIFY', async () => {
    const empty = { version: 1 as const, dialect: 'mysql' as const, tables: {} }
    const columns = {
      token: varchar(36).defaultSql('uuid()'),
      n: integer().notNull().default('floor(rand() * 0)'),
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
    const [rows] = (await pool.query('SELECT token, n, doc, body, path FROM d')) as [any[], unknown]
    expect(rows[0].token).toMatch(/^[0-9a-f-]{36}$/)
    expect({ ...rows[0], token: undefined }).toEqual({
      token: undefined,
      n: 0,
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

describe('timestamp precision on MySQL', () => {
  it('stores milliseconds in a timestamp({ precision: 3 }) defaulting to now', async () => {
    const empty = { version: 1 as const, dialect: 'mysql' as const, tables: {} }
    const target = extractSnapshot(
      {
        ms: table('ms', {
          id: serial().primaryKey(),
          at: timestamp({ precision: 3 }).notNull().defaultNow(),
        }),
      },
      'mysql',
    )
    await pool.query(emitMysql(diff(empty, target)))
    await pool.query('INSERT INTO ms () VALUES ()')
    const [rows] = (await pool.query("SELECT DATE_FORMAT(at, '%f') AS f FROM ms")) as [
      Array<{ f: string }>,
      unknown,
    ]
    // Six digits of fraction, the first three kept, the rest zero.
    expect(rows[0]!.f).toMatch(/^\d{3}000$/)
  }, 60_000)
})
