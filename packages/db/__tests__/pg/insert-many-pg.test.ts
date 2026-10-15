/**
 * `db.insertMany()` on Postgres: past 65,535 bind parameters one statement
 * fails; insertMany splits the rows.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'
import {
  createDbClient,
  diff,
  emitPg,
  extractSnapshot,
  integer,
  serial,
  table,
  text,
  varchar,
} from '@forinda/kickjs-db'
import { pgDialect } from '@forinda/kickjs-db/pg'

const events = table('events', {
  id: serial().primaryKey(),
  code: varchar(64).notNull().unique(),
  kind: text().notNull(),
  weight: integer().notNull(),
})
const schema = { events }

let container: StartedPostgreSqlContainer
let pool: pg.Pool

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  pool = new pg.Pool({ connectionString: container.getConnectionUri(), max: 5 })
  pool.on('error', () => {})
  const empty = { version: 1 as const, dialect: 'postgres' as const, tables: {} }
  await pool.query(emitPg(diff(empty, extractSnapshot(schema, 'postgres'))))
}, 120_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
}, 60_000)

const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ code: `e-${i}`, kind: 'click', weight: i % 7 }))

describe('insertMany on Postgres', () => {
  it('inserts 25,000 rows × 3 columns (75,000 parameters) in two statements', async () => {
    const db = createDbClient({ schema, dialect: pgDialect({ pool }), events: true })
    await expect(db.insertInto('events').values(rows(25_000)).execute()).rejects.toThrow()
    const statements: string[] = []
    db.on('query', (e) => void statements.push(e.sql))
    const inserted = await db.insertMany('events', rows(25_000), { returning: true })
    expect(inserted).toHaveLength(25_000)
    expect(inserted[24_999]).toMatchObject({ code: 'e-24999' })
    expect(statements.filter((s) => /^insert/i.test(s))).toHaveLength(2)
    await db.deleteFrom('events').execute()
  })
})
