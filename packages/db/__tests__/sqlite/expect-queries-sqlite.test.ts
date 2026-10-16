/**
 * `captureQueries` / `expectQueries` — counting the queries a block sends,
 * the guard against N+1 queries.
 */
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { createDbClient, integer, serial, table, text } from '@forinda/kickjs-db'
import { sqliteDialect } from '@forinda/kickjs-db/sqlite'
import { captureQueries, createTestDb, expectQueries } from '@forinda/kickjs-db/testing'

const users = table('users', { id: serial().primaryKey(), email: text().notNull() })
const posts = table('posts', {
  id: serial().primaryKey(),
  authorId: integer()
    .notNull()
    .references(() => users.id),
})
const schema = { users, posts }

async function seeded() {
  const db = await createTestDb({ schema })
  for (const email of ['a@x.com', 'b@x.com', 'c@x.com']) {
    const { id } = await db
      .insertInto('users')
      .values({ email })
      .returning('id')
      .executeTakeFirstOrThrow()
    await db.insertInto('posts').values({ authorId: id }).execute()
  }
  return db
}

describe('expectQueries', () => {
  it('passes on the exact count and returns the result', async () => {
    const db = await seeded()
    const rows = await expectQueries(db, 1, () => db.selectFrom('users').selectAll().execute())
    expect(rows).toHaveLength(3)
  })

  it('catches an N+1, listing every query it saw', async () => {
    const db = await seeded()
    const nPlusOne = async () => {
      const all = await db.selectFrom('posts').selectAll().execute()
      for (const post of all) {
        await db.selectFrom('users').selectAll().where('id', '=', post.authorId).execute()
      }
    }
    const failure = await expectQueries(db, 2, nPlusOne).catch((err: Error) => err)
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toMatch(/Expected 2 queries, ran 4/)
    expect((failure as Error).message).toMatch(/1\. select \* from "posts"/)
  })

  it('stops listening afterwards', async () => {
    const db = await seeded()
    const { queries } = await captureQueries(db, async () => {
      await db.selectFrom('users').selectAll().execute()
    })
    await db.selectFrom('users').selectAll().execute()
    expect(queries).toHaveLength(1)
  })

  it('refuses a client without events instead of counting zero', async () => {
    const db = createDbClient({
      schema,
      dialect: sqliteDialect({ database: new Database(':memory:') }),
    })
    await expect(captureQueries(db, async () => {})).rejects.toThrow(/events: true/)
  })
})

describe('beforeQuery', () => {
  it('sees each statement before it runs, and may rewrite it', async () => {
    const db = await seeded()
    const seen: string[] = []
    db.on('beforeQuery', (e) => {
      seen.push(e.sql)
      // Tag every statement, and swap a bound value.
      e.sql = `/* app */ ${e.sql}`
      e.parameters = e.parameters.map((p) => (p === 'a@x.com' ? 'b@x.com' : p))
    })
    const rows = await db
      .selectFrom('users')
      .select('email')
      .where('email', '=', 'a@x.com')
      .execute()
    expect(rows).toEqual([{ email: 'b@x.com' }])
    expect(seen).toEqual(['select "email" from "users" where "email" = ?'])
  })
})

describe('query event correlation', () => {
  it('pairs beforeQuery, query and queryError by queryId, and tags a transaction’s queries with txId', async () => {
    const db = await seeded()
    const before: Array<string | undefined> = []
    const done: Array<{ queryId?: string; txId?: string }> = []
    const failed: Array<{ queryId?: string; txId?: string }> = []
    db.on('beforeQuery', (e) => {
      before.push(e.queryId)
    })
    db.on('query', (e) => {
      done.push({ queryId: e.queryId, txId: e.txId })
    })
    db.on('queryError', (e) => {
      failed.push({ queryId: e.queryId, txId: e.txId })
    })
    await db.selectFrom('users').select('id').execute()
    expect(done.at(-1)!.txId).toBeUndefined()
    expect(before).toContain(done.at(-1)!.queryId)

    await db.transaction(async (tx) => {
      await tx.selectFrom('users').select('id').execute()
      await tx.selectFrom('posts').select('id').execute()
    })
    // begin, the two selects, commit: one transaction id, a query id each.
    const inTx = done.filter((e) => e.txId)
    expect(inTx).toHaveLength(4)
    expect(inTx[0]!.txId).toMatch(/^tx\d+$/)
    expect(new Set(inTx.map((e) => e.txId)).size).toBe(1)
    expect(new Set(inTx.map((e) => e.queryId)).size).toBe(4)

    await expect(
      db
        .selectFrom('nope' as 'users')
        .selectAll()
        .execute(),
    ).rejects.toThrow()
    expect(failed).toHaveLength(1)
    expect(before).toContain(failed[0]!.queryId)
  })
})

describe('startTransaction()', () => {
  it('commits or rolls back when told, runs afterCommit, and refuses a second finish', async () => {
    const db = await seeded()
    const events: string[] = []
    db.on('transactionStart', () => {
      events.push('start')
    })
    db.on('transactionCommit', () => {
      events.push('commit')
    })
    db.on('transactionRollback', () => {
      events.push('rollback')
    })
    const count = async () =>
      Number(
        (
          await db
            .selectFrom('users')
            .select((eb) => eb.fn.countAll().as('n'))
            .executeTakeFirstOrThrow()
        ).n,
      )

    const kept = await db.startTransaction()
    let ran = false
    await kept.insertInto('users').values({ email: 'kept@x.com' }).execute()
    await kept.afterCommit(() => {
      ran = true
    })
    expect(ran).toBe(false)
    await kept.commit()
    expect(ran).toBe(true)
    expect(await count()).toBe(4)
    await expect(kept.commit()).rejects.toThrow()

    const dropped = await db.startTransaction()
    await dropped.insertInto('users').values({ email: 'gone@x.com' }).execute()
    // Its own savepoint works too.
    await dropped.savepoint(async (sp) => {
      await sp.insertInto('users').values({ email: 'sp@x.com' }).execute()
    })
    await dropped.rollback()
    expect(await count()).toBe(4)
    expect(events).toEqual(['start', 'commit', 'start', 'rollback'])

    await expect(db.transaction(() => db.startTransaction())).rejects.toThrow(/use savepoint/)
    // transaction()'s guards hold here too.
    await expect(db.startTransaction({ readOnly: true })).rejects.toThrow(/read-only/)
    await expect(db.startTransaction({ role: 'app' })).rejects.toThrow(/Postgres-only/)
  })

  it('queues afterCommit from its savepoints and nested transactions until it commits', async () => {
    const db = await seeded()
    const ran: string[] = []
    const tx = await db.startTransaction()
    await tx.savepoint(async (sp) => {
      await sp.afterCommit(() => {
        ran.push('savepoint')
      })
    })
    await tx.transaction(async (inner) => {
      await inner.afterCommit(() => {
        ran.push('nested')
      })
    })
    // A hook queued inside a savepoint that rolls back is dropped with it.
    await tx
      .transaction({ nested: 'savepoint' }, async () => {
        await tx.afterCommit(() => {
          ran.push('rolled back')
        })
        throw new Error('undo')
      })
      .catch(() => {})
    expect(ran).toEqual([])
    await tx.commit()
    expect(ran).toEqual(['savepoint', 'nested'])
  })
})

describe('asyncStackTraces', () => {
  const failing = (db: ReturnType<typeof createDbClient>) =>
    function readFromAMissingTable() {
      return db
        .selectFrom('nope' as never)
        .selectAll()
        .execute()
    }

  it("adds the caller's frames to a failed query's stack", async () => {
    const database = new Database(':memory:')
    const db = createDbClient({
      schema,
      dialect: sqliteDialect({ database }),
      asyncStackTraces: true,
    })
    const err = (await failing(db)().catch((e: unknown) => e)) as Error
    const built = err.stack!.split('--- the query was built ---')[1]!
    // The caller's own frames — this file — and none of Kysely's or kick/db's.
    expect(built).toContain('expect-queries-sqlite.test.ts')
    expect(built).not.toMatch(/[\\/]kysely[\\/]|packages[\\/]db[\\/]src/)
  })

  it('adds nothing without it', async () => {
    const db = createDbClient({
      schema,
      dialect: sqliteDialect({ database: new Database(':memory:') }),
    })
    const err = (await failing(db)().catch((e: unknown) => e)) as Error
    expect(err.stack).not.toContain('--- the query was built ---')
  })
})
