/** D.28 on MySQL: push creates, finds nothing the second time, applies a change, spots outside edits. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql'
import { createPool, type Pool } from 'mysql2/promise'
import { pushSchema, table, text, uuid } from '@forinda/kickjs-db'
import { mysqlAdapter } from '@forinda/kickjs-db/mysql'
import * as schema from '../setup/push-schema'

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

describe('pushSchema on MySQL', () => {
  it('round-trips the schema and applies changes', async () => {
    const adapter = mysqlAdapter({ pool })
    expect(await pushSchema({ adapter, schema })).toMatchObject({ status: 'pushed' })
    expect(await pushSchema({ adapter, schema })).toEqual({ status: 'no-changes', changeCount: 0 })

    const tags = table('tags', { id: uuid().primaryKey().defaultRandom(), name: text().notNull() })
    expect(await pushSchema({ adapter, schema: { ...schema, tags } })).toEqual({
      status: 'pushed',
      changeCount: 1,
    })
    expect(await pushSchema({ adapter, schema: { ...schema, tags } })).toMatchObject({
      status: 'no-changes',
    })

    await pool.query('alter table tags add column extra text')
    await expect(pushSchema({ adapter, schema: { ...schema, tags } })).rejects.toThrow(
      /changed since the last push/,
    )
  })
})
