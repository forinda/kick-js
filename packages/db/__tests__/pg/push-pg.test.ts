/** D.28 on Postgres: push creates, finds nothing the second time, applies a change, spots outside edits. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'
import { pushSchema, table, text, uuid } from '@forinda/kickjs-db'
import { pgAdapter } from '@forinda/kickjs-db/pg'
import * as schema from '../setup/push-schema'

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

describe('pushSchema on Postgres', () => {
  it('round-trips the schema and applies changes', async () => {
    const adapter = pgAdapter({ pool })
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
      /differs from what was last pushed/,
    )
  })
})
