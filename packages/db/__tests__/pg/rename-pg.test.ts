/**
 * D.17 on Postgres: a table and a column named as renames keep their rows,
 * with the renamed column's type changed too, and come back on the way down.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'
import {
  diff,
  emitPg,
  extractSnapshot,
  invertChanges,
  serial,
  table,
  text,
  varchar,
} from '@forinda/kickjs-db'

let container: StartedPostgreSqlContainer
let pool: pg.Pool

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  pool = new pg.Pool({ connectionString: container.getConnectionUri() })
  pool.on('error', () => {})
}, 120_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
}, 60_000)

describe('renames on Postgres', () => {
  it('keeps the data through a table and column rename, and back', async () => {
    const v1 = extractSnapshot(
      { users: table('users', { id: serial().primaryKey(), fullName: text().notNull() }) },
      'postgres',
    )
    const v2 = extractSnapshot(
      { people: table('people', { id: serial().primaryKey(), name: varchar(100).notNull() }) },
      'postgres',
    )
    const empty = { version: 1 as const, dialect: 'postgres' as const, tables: {} }
    await pool.query(emitPg(diff(empty, v1)))
    await pool.query(`INSERT INTO users ("fullName") VALUES ('Ada')`)

    const changes = diff(v1, v2, {
      renames: { tables: { users: 'people' }, columns: { 'people.fullName': 'name' } },
      explicitRenames: true,
    })
    await pool.query(emitPg(changes))
    const { rows } = await pool.query('SELECT id, name FROM people')
    expect(rows).toEqual([{ id: 1, name: 'Ada' }])

    await pool.query(emitPg(invertChanges(changes)))
    const back = await pool.query('SELECT id, "fullName" FROM users')
    expect(back.rows).toEqual([{ id: 1, fullName: 'Ada' }])
  }, 60_000)
})
