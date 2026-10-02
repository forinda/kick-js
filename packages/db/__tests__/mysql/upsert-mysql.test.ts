/**
 * `db.upsert()` and `db.findOrCreate()` on MySQL — `ON DUPLICATE KEY
 * UPDATE`, with the rows read back (no RETURNING).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql'
import { createPool, type Pool } from 'mysql2/promise'
import {
  createDbClient,
  diff,
  emitMysql,
  extractSnapshot,
  serial,
  table,
  text,
  varchar,
} from '@forinda/kickjs-db'
import { mysqlDialect } from '@forinda/kickjs-db/mysql'

const users = table('users', {
  id: serial().primaryKey(),
  email: varchar(255).notNull().unique(),
  name: text().notNull(),
})
const schema = { users }

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

describe('upsert and findOrCreate on MySQL', () => {
  it('upserts one and many, returning the stored rows', async () => {
    const db = createDbClient({ schema, dialect: mysqlDialect({ pool }) })
    const first = await db.upsert('users', {
      values: { email: 'a@x.com', name: 'Ada' },
      target: ['email'],
    })
    expect(first).toMatchObject({ email: 'a@x.com', name: 'Ada' })

    const rows = await db.upsert('users', {
      values: [
        { email: 'a@x.com', name: 'Ada 2' },
        { email: 'b@x.com', name: 'Bob' },
      ],
      target: ['email'],
    })
    expect(rows.map((r) => [r.email, r.name]).toSorted()).toEqual([
      ['a@x.com', 'Ada 2'],
      ['b@x.com', 'Bob'],
    ])
    expect(rows.find((r) => r.email === 'a@x.com')!.id).toBe(first.id)
  }, 60_000)

  it('findOrCreate creates once, then finds — also when racing', async () => {
    const db = createDbClient({ schema, dialect: mysqlDialect({ pool }) })
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        db.findOrCreate('users', { where: { email: 'r@x.com' }, create: { name: 'R' } }),
      ),
    )
    expect(new Set(results.map((r) => r.row.id)).size).toBe(1)
    expect(results.filter((r) => r.created)).toHaveLength(1)
  }, 60_000)

  it('refuses a partial-index where, which MySQL has no syntax for', async () => {
    const db = createDbClient({ schema, dialect: mysqlDialect({ pool }) })
    await expect(
      db.upsert('users', {
        values: { email: 'c@x.com', name: 'C' },
        target: ['email'],
        where: (eb) => eb('name', '=', 'C'),
      }),
    ).rejects.toThrow(/MySQL/)
  }, 30_000)
})
