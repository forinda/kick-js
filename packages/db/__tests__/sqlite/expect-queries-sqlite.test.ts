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
