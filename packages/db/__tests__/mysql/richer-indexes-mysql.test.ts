/**
 * D.9 richer indexes on MySQL 8: a functional (expression) unique index
 * applies and enforces, and introspection reads it back without drift.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql'
import { createPool, type Pool } from 'mysql2/promise'
import {
  checkDrift,
  diff,
  emitMysql,
  extractSnapshot,
  index,
  introspectMysql,
  serial,
  table,
  unique,
  varchar,
} from '@forinda/kickjs-db'

const users = table('users', { id: serial().primaryKey(), email: varchar(255).notNull() }, (t) => ({
  lower: unique('users_email_lower').on('lower(email)'),
  hashed: index('users_email_hash').on(t.email).using('hash'),
}))

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

describe('richer indexes on MySQL', () => {
  it('applies, enforces and introspects without drift', async () => {
    const target = extractSnapshot({ users }, 'mysql')
    await pool.query(emitMysql(diff({ version: 1, dialect: 'mysql', tables: {} }, target)))

    await pool.query(`INSERT INTO users (email) VALUES ('A@x.io')`)
    await expect(pool.query(`INSERT INTO users (email) VALUES ('a@x.io')`)).rejects.toThrow(
      /users_email_lower/,
    )

    const live = await introspectMysql(pool)
    const lower = live.tables.users.indexes.find((i) => i.name === 'users_email_lower')
    expect(lower).toMatchObject({ unique: true })
    expect(lower!.columns[0]).toMatch(/^\(lower\(`email`\)\)$/)
    await expect(checkDrift(live, target, 'error')).resolves.toBeUndefined()
  }, 60_000)
})
