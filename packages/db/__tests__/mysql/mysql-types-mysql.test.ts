/** D.24: MySQL column types — mysqlEnum, unsigned integers, tinyint/mediumint, datetime. */
import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from 'vitest'
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql'
import { createPool, type Pool } from 'mysql2/promise'
import {
  bigint,
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
import {
  datetime,
  mediumint,
  mysqlDialect,
  mysqlEnum,
  tinyint,
  unsigned,
} from '@forinda/kickjs-db/mysql'
import { insertSchema } from '@forinda/kickjs-db/schema'

const events = table('events', {
  id: serial().primaryKey(),
  status: mysqlEnum('Draft', 'Live', "Won't run").notNull(),
  hits: unsigned(integer()).notNull(),
  big: unsigned(bigint({ mode: 'string' })),
  level: unsigned(tinyint()),
  bucket: mediumint(),
  at: datetime(3).notNull(),
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
    timezone: 'Z',
    // Without these mysql2 reads BIGINT as a JS number, losing digits past 2^53.
    supportBigNumbers: true,
    bigNumberStrings: true,
  })
  const empty = { version: 1 as const, dialect: 'mysql' as const, tables: {} }
  await pool.query(emitMysql(diff(empty, extractSnapshot(schema, 'mysql'))))
}, 180_000)
afterAll(async () => {
  await pool?.end()
  await container?.stop()
}, 60_000)

describe('MySQL column types', () => {
  it('stores and reads them, keeping enum case and unsigned range', async () => {
    const db = createDbClient({ schema, dialect: mysqlDialect({ pool }) })
    const at = new Date('2026-10-03T12:34:56.789Z')
    await db
      .insertInto('events')
      .values({
        status: "Won't run",
        hits: 4_000_000_000, // above INT's signed max
        big: '18446744073709551615',
        level: 255,
        bucket: -5,
        at,
      })
      .execute()
    const row = await db.selectFrom('events').selectAll().executeTakeFirstOrThrow()
    expect(row).toMatchObject({
      status: "Won't run",
      hits: 4_000_000_000,
      big: '18446744073709551615',
      level: 255,
      bucket: -5,
      at,
    })
    expectTypeOf(row.status).toEqualTypeOf<'Draft' | 'Live' | "Won't run">()
    await expect(
      db
        .insertInto('events')
        .values({ status: 'Gone' as never, hits: 1, at })
        .execute(),
    ).rejects.toThrow()
  })

  it('introspects them back without drift, enum case intact', async () => {
    const live = await introspectMysql(pool as never, {})
    expect(live.tables.events.columns.status.type).toBe("enum('Draft','Live','Won''t run')")
    expect(live.tables.events.columns.hits.type).toBe('int unsigned')
    expect(live.tables.events.columns.at.type).toBe('datetime(3)')
    await expect(checkDrift(live, extractSnapshot(schema, 'mysql'), 'error')).resolves.not.toThrow()
  })

  it('validates enum values with their case', () => {
    const insert = insertSchema(events)
    const at = new Date().toISOString()
    expect(insert.safeParse({ status: 'Live', hits: 1, at }).success).toBe(true)
    expect(insert.safeParse({ status: 'live', hits: 1, at }).success).toBe(false)
    expect(insert.safeParse({ status: 'Live', hits: -1, at }).success).toBe(false)
    expect(insert.safeParse({ status: 'Live', hits: 1, level: 256, at }).success).toBe(false)
  })
})
