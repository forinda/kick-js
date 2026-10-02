/**
 * Call-chain transactions and retry against a real Postgres: an independent
 * nested transaction, concurrent call chains kept apart, and `retry`
 * recovering from a genuine serialization failure.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'
import { PostgresDialect } from 'kysely'
import { createDbClient, integer, table, varchar, type KickDbClient } from '@forinda/kickjs-db'

interface DB {
  log: { id: number; note: string }
  counters: { id: number; n: number }
}
const schema = {
  log: table('log', { id: integer().primaryKey(), note: varchar(100) }),
  counters: table('counters', { id: integer().primaryKey(), n: integer() }),
}

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let db: KickDbClient<DB>

const notes = async () =>
  (await db.selectFrom('log').select('note').orderBy('id').execute()).map((r) => r.note)

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  pool = new pg.Pool({
    host: container.getHost(),
    port: container.getMappedPort(5432),
    user: container.getUsername(),
    password: container.getPassword(),
    database: container.getDatabase(),
  })
  pool.on('error', () => {})
  await pool.query(`
    CREATE TABLE log (id int PRIMARY KEY, note varchar(100) NOT NULL);
    CREATE TABLE counters (id int PRIMARY KEY, n int NOT NULL);
  `)
  db = createDbClient<typeof schema, DB>({ schema, dialect: new PostgresDialect({ pool }) })
}, 120_000)

beforeEach(async () => {
  await pool.query(
    'DELETE FROM log; DELETE FROM counters; INSERT INTO counters VALUES (1, 0), (2, 0)',
  )
})

afterAll(async () => {
  await db?.destroy()
  await container?.stop()
})

describe('call-chain transactions (postgres)', () => {
  it("nested: 'separate' commits on its own even when the outer rolls back", async () => {
    await expect(
      db.transaction(async () => {
        await db.insertInto('log').values({ id: 1, note: 'outer' }).execute()
        await db.transaction({ nested: 'separate' }, async () => {
          await db.insertInto('log').values({ id: 2, note: 'audit' }).execute()
        })
        throw new Error('outer fails')
      }),
    ).rejects.toThrow('outer fails')
    expect(await notes()).toEqual(['audit'])
  })

  it('concurrent call chains each get their own transaction', async () => {
    let release!: () => void
    const both = new Promise<void>((r) => (release = r))
    let started = 0
    const chain = (id: number, fail: boolean) =>
      db.transaction(async () => {
        await db
          .insertInto('log')
          .values({ id, note: `chain${id}` })
          .execute()
        if (++started === 2) release()
        await both
        if (fail) throw new Error('only this chain')
      })
    const [ok, bad] = await Promise.allSettled([chain(1, false), chain(2, true)])
    expect(ok.status).toBe('fulfilled')
    expect(bad.status).toBe('rejected')
    expect(await notes()).toEqual(['chain1'])
  })

  it('retry: true recovers from a real serialization failure', async () => {
    let release!: () => void
    const bothRead = new Promise<void>((r) => (release = r))
    let reads = 0
    let attempts = 0
    const run = (id: number) =>
      db.transaction({ isolation: 'serializable', retry: true }, async () => {
        attempts++
        await db.selectFrom('counters').selectAll().execute()
        if (++reads === 2) release()
        await bothRead
        await db
          .updateTable('counters')
          .set({ n: 1 })
          .where('id', '=', id === 1 ? 2 : 1)
          .execute()
      })
    await Promise.all([run(1), run(2)]) // without retry, one of these rejects
    // At least one retry. Under load the retried run can conflict again before
    // the other commits, so the exact count isn't fixed.
    expect(attempts).toBeGreaterThanOrEqual(3)
    const rows = await db.selectFrom('counters').select('n').execute()
    expect(rows.map((r) => r.n)).toEqual([1, 1])
  })
})
