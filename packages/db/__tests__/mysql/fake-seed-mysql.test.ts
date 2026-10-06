/** D.29 on MySQL: seeded rows insert with real foreign keys and come back filled in. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql'
import { createPool, type Pool } from 'mysql2/promise'
import { createDbClient, pushSchema, seedFake } from '@forinda/kickjs-db'
import { mysqlAdapter, mysqlDialect } from '@forinda/kickjs-db/mysql'
import * as all from '../setup/fake-schema'

const { notes: _notes, ...schema } = all
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

describe('seedFake on MySQL', () => {
  it('fills related tables', async () => {
    const db = createDbClient({ schema, dialect: mysqlDialect({ pool }) })
    const out = await seedFake(db, schema, {
      counts: { users: 3, posts: 8, tags: 4, post_tags: 12 },
    })
    const [rows] = await pool.query(
      `select (select count(*) from users) u, (select count(*) from posts) p, (select count(*) from post_tags) pt`,
    )
    expect((rows as any[])[0]).toEqual({ u: 3, p: 8, pt: 12 })
    expect(out.posts!.every((p) => typeof p.id === 'number')).toBe(true)
  })
})
