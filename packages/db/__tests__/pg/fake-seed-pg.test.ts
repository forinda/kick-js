/** D.29 on Postgres: seeded rows insert with real foreign keys and come back filled in. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'
import { createDbClient, pushSchema, seedFake } from '@forinda/kickjs-db'
import { pgAdapter, pgDialect } from '@forinda/kickjs-db/pg'
import * as all from '../setup/fake-schema'

const { notes: _notes, ...schema } = all
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

describe('seedFake on Postgres', () => {
  it('fills related tables', async () => {
    const db = createDbClient({ schema, dialect: pgDialect({ pool }) })
    const out = await seedFake(db, schema, {
      counts: { users: 3, posts: 8, tags: 4, post_tags: 12 },
    })
    const { rows } = await pool.query(
      `select (select count(*) from users) u, (select count(*) from posts) p, (select count(*) from post_tags) pt`,
    )
    expect(rows[0]).toEqual({ u: '3', p: '8', pt: '12' })
    expect(out.posts!.every((p) => typeof p.id === 'number')).toBe(true)
  })
})
