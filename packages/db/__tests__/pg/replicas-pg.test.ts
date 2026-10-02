/** Read replicas on Postgres: two throwaway databases stand in for primary and replica. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'
import { createDbClient, serial, table, text } from '@forinda/kickjs-db'
import { pgDialect } from '@forinda/kickjs-db/pg'
import { createPgTestDb, type PgTestDb } from '@forinda/kickjs-db/testing'

const notes = table('notes', { id: serial().primaryKey(), body: text().notNull() })
const schema = { notes }

let container: StartedPostgreSqlContainer
let primary: PgTestDb<typeof schema>
let replica: PgTestDb<typeof schema>

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  primary = await createPgTestDb({ schema, connectionString: container.getConnectionUri() })
  replica = await createPgTestDb({ schema, connectionString: container.getConnectionUri() })
  await replica.db.insertInto('notes').values({ body: 'from replica' }).execute()
}, 120_000)

afterAll(async () => {
  await primary?.drop()
  await replica?.drop()
  await container?.stop()
}, 60_000)

describe('read replicas on Postgres', () => {
  it('routes reads to the replica and writes to the primary', async () => {
    const primaryPool = new pg.Pool({ connectionString: primary.connectionString })
    const replicaPool = new pg.Pool({ connectionString: replica.connectionString })
    const db = createDbClient({
      schema,
      dialect: pgDialect({ pool: primaryPool }),
      replica: pgDialect({ pool: replicaPool }),
    })
    try {
      await db.insertInto('notes').values({ body: 'written' }).execute()
      expect((await db.query.notes.findMany()).map((n) => n.body)).toEqual(['from replica'])
      expect(
        (await db.primary.selectFrom('notes').select('body').execute()).map((n) => n.body),
      ).toEqual(['written'])
    } finally {
      await db.destroy() // ends both pools
    }
  }, 30_000)
})
