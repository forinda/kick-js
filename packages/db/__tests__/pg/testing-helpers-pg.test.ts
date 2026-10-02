/**
 * `createPgTestDb` — a throwaway database per test file on one Postgres
 * server, dropped afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'
import { serial, table, text } from '@forinda/kickjs-db'
import { createPgTestDb, rolledBack } from '@forinda/kickjs-db/testing'

const users = table('users', { id: serial().primaryKey(), email: text().notNull().unique() })
const schema = { users }

let container: StartedPostgreSqlContainer
let server: string

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  server = container.getConnectionUri()
}, 120_000)

afterAll(async () => {
  await container?.stop()
}, 60_000)

async function databases() {
  const client = new pg.Client({ connectionString: server })
  await client.connect()
  const { rows } = await client.query<{ datname: string }>(
    "select datname from pg_database where datname like 'kick_test_%'",
  )
  await client.end()
  return rows.map((r) => r.datname)
}

describe('createPgTestDb', () => {
  it('creates separate databases with the schema, and drops them', async () => {
    const a = await createPgTestDb({ schema, connectionString: server })
    const b = await createPgTestDb({ schema, connectionString: server })
    expect(a.connectionString).not.toBe(b.connectionString)

    await a.db.insertInto('users').values({ email: 'a@x.com' }).execute()
    expect(await b.db.selectFrom('users').selectAll().execute()).toEqual([])

    await rolledBack(b.db, async () => {
      await b.db.insertInto('users').values({ email: 'b@x.com' }).execute()
    })
    expect(await b.db.selectFrom('users').selectAll().execute()).toEqual([])

    expect(await databases()).toHaveLength(2)
    await a.drop()
    await b.drop()
    expect(await databases()).toEqual([])
  }, 60_000)
})
