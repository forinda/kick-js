/** D.21 `.dbName()` on Postgres. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'
import { createDbClient, pushSchema } from '@forinda/kickjs-db'
import { pgAdapter, pgDialect } from '@forinda/kickjs-db/pg'
import * as schema from '../setup/column-names-schema'
import { columnNamesFlow } from '../setup/column-names-flow'

let container: StartedPostgreSqlContainer
let pool: pg.Pool

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  pool = new pg.Pool({ connectionString: container.getConnectionUri() })
  pool.on('error', () => {})
  await pushSchema({ adapter: pgAdapter({ pool }), schema })
}, 120_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
}, 60_000)

describe('.dbName() on Postgres', () => {
  it('creates the columns under their names and reads and writes them by key', async () => {
    const { rows } = await pool.query(
      `select column_name from information_schema.columns where table_name = 'users' order by ordinal_position`,
    )
    expect(rows.map((r) => r.column_name)).toEqual(['id', 'EMAIL_ADDR', 'FULL_NM', 'MODIFIED'])
    await columnNamesFlow(createDbClient({ schema, dialect: pgDialect({ pool }) }))
  })
})
