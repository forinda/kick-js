/** D.21 `.dbName()` on MySQL. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql'
import { createPool, type Pool } from 'mysql2/promise'
import { createDbClient, pushSchema } from '@forinda/kickjs-db'
import { mysqlAdapter, mysqlDialect } from '@forinda/kickjs-db/mysql'
import * as schema from '../setup/column-names-schema'
import { columnNamesFlow } from '../setup/column-names-flow'

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
  })
  await pushSchema({ adapter: mysqlAdapter({ pool }), schema })
}, 180_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
}, 60_000)

describe('.dbName() on MySQL', () => {
  it('creates the columns under their names and reads and writes them by key', async () => {
    const [rows] = await pool.query(
      `select column_name as c from information_schema.columns where table_schema = database() and table_name = 'users' order by ordinal_position`,
    )
    expect((rows as { c: string }[]).map((r) => r.c)).toEqual([
      'id',
      'EMAIL_ADDR',
      'FULL_NM',
      'MODIFIED',
    ])
    await columnNamesFlow(createDbClient({ schema, dialect: mysqlDialect({ pool }) }))
  })
})
