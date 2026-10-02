/**
 * The examples on the "Raw SQL and recipes" docs page, run against SQLite.
 * (Postgres-only recipes — JSON operators — run in the pg suite.)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { sql } from 'kysely'
import {
  createDbClient,
  diff,
  emitSqlite,
  extractSnapshot,
  integer,
  likePattern,
  serial,
  table,
  text,
  varchar,
} from '@forinda/kickjs-db'
import { sqliteDialect } from '@forinda/kickjs-db/sqlite'

const users = table('users', {
  id: serial().primaryKey(),
  email: varchar(255).notNull().unique(),
  name: text().notNull(),
  logins: integer().notNull().default(0),
})
const posts = table('posts', {
  id: serial().primaryKey(),
  authorId: integer().notNull(),
  title: text().notNull(),
  createdAt: integer().notNull(),
})
const schema = { users, posts }

let db: ReturnType<typeof make>
function make() {
  const database = new Database(':memory:')
  const empty = { version: 1 as const, dialect: 'sqlite' as const, tables: {} }
  const target = extractSnapshot(schema, 'sqlite')
  database.exec(emitSqlite(diff(empty, target), { from: empty, to: target }))
  return createDbClient({ schema, dialect: sqliteDialect({ database }) })
}

beforeAll(async () => {
  db = make()
  await db
    .insertInto('users')
    .values([
      { email: 'a@x.io', name: 'Ann' },
      { email: 'b@x.io', name: 'Bob' },
      { email: '100%@x.io', name: 'Pct' },
    ])
    .execute()
  await db
    .insertInto('posts')
    .values([
      { authorId: 1, title: 'one', createdAt: 10 },
      { authorId: 1, title: 'two', createdAt: 20 },
      { authorId: 2, title: 'three', createdAt: 20 },
      { authorId: 2, title: 'four', createdAt: 30 },
    ])
    .execute()
})
afterAll(() => db.destroy())

describe('raw SQL', () => {
  it('runs a sql template, parameterised, on the client', async () => {
    const email = 'a@x.io'
    const { rows } = await sql<{
      name: string
    }>`select name from users where email = ${email}`.execute(db.qb)
    expect(rows).toEqual([{ name: 'Ann' }])
  })

  it('joins the open transaction through db.qb', async () => {
    await db
      .transaction(async () => {
        await sql`update users set name = 'changed' where id = 1`.execute(db.qb)
        throw new Error('rollback')
      })
      .catch(() => {})
    const row = await db
      .selectFrom('users')
      .select('name')
      .where('id', '=', 1)
      .executeTakeFirstOrThrow()
    expect(row.name).toBe('Ann')
  })

  it('mixes SQL into the builder, and compiles without running', async () => {
    const rows = await db
      .selectFrom('users')
      .select(['name', sql<string>`upper(email)`.as('shout')])
      .where(sql<boolean>`length(name) = ${3}`)
      .orderBy('id')
      .execute()
    expect(rows[0]).toEqual({ name: 'Ann', shout: 'A@X.IO' })

    const { sql: text, parameters } = db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', 7)
      .compile()
    expect(text).toBe('select * from "users" where "id" = ?')
    expect(parameters).toEqual([7])
  })

  it('identifiers through sql.ref, never through sql.raw', async () => {
    const column = 'email'
    const { rows } = await sql<{
      v: string
    }>`select ${sql.ref(column)} as v from users where id = 1`.execute(db.qb)
    expect(rows).toEqual([{ v: 'a@x.io' }])
  })

  it('searches with a literal-safe LIKE (SQLite needs ESCAPE)', async () => {
    const rows = await db
      .selectFrom('users')
      .select('email')
      .where(sql<boolean>`email like ${likePattern('100%', 'startsWith')} escape '\\'`)
      .execute()
    expect(rows).toEqual([{ email: '100%@x.io' }])
  })
})

describe('recipes', () => {
  it('upsert — insert or update on conflict', async () => {
    await db
      .insertInto('users')
      .values({ email: 'a@x.io', name: 'Ann B.' })
      .onConflict((oc) => oc.column('email').doUpdateSet({ name: (eb) => eb.ref('excluded.name') }))
      .execute()
    const row = await db
      .selectFrom('users')
      .select('name')
      .where('email', '=', 'a@x.io')
      .executeTakeFirstOrThrow()
    expect(row.name).toBe('Ann B.')
  })

  it('increment a counter', async () => {
    await db
      .updateTable('users')
      .set((eb) => ({ logins: eb('logins', '+', 1) }))
      .where('id', '=', 2)
      .execute()
    const row = await db
      .selectFrom('users')
      .select('logins')
      .where('id', '=', 2)
      .executeTakeFirstOrThrow()
    expect(row.logins).toBe(1)
  })

  it('keyset pagination over (createdAt, id)', async () => {
    const page = (after?: { createdAt: number; id: number }) =>
      db
        .selectFrom('posts')
        .select(['id', 'createdAt'])
        .$if(after !== undefined, (qb) =>
          qb.where((eb) =>
            eb(eb.refTuple('createdAt', 'id'), '<', eb.tuple(after!.createdAt, after!.id)),
          ),
        )
        .orderBy('createdAt', 'desc')
        .orderBy('id', 'desc')
        .limit(2)
        .execute()
    const first = await page()
    const second = await page(first.at(-1))
    expect([...first, ...second].map((r) => r.id)).toEqual([4, 3, 2, 1])
  })

  it('count, exists, group by with having', async () => {
    const { n } = await db
      .selectFrom('posts')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .executeTakeFirstOrThrow()
    expect(n).toBe(4)

    const authors = await db
      .selectFrom('users')
      .select('name')
      .where((eb) =>
        eb.exists(eb.selectFrom('posts').select('id').whereRef('posts.authorId', '=', 'users.id')),
      )
      .orderBy('id')
      .execute()
    expect(authors.map((a) => a.name)).toEqual(['Ann B.', 'Bob'])

    const busy = await db
      .selectFrom('posts')
      .select(['authorId', (eb) => eb.fn.count<number>('id').as('posts')])
      .groupBy('authorId')
      .having((eb) => eb.fn.count('id'), '>=', 2)
      .orderBy('authorId')
      .execute()
    expect(busy).toEqual([
      { authorId: 1, posts: 2 },
      { authorId: 2, posts: 2 },
    ])
  })

  it('conditional filters with $if', async () => {
    const search = (name?: string) =>
      db
        .selectFrom('users')
        .select('id')
        .$if(name !== undefined, (qb) => qb.where('name', '=', name!))
        .execute()
    expect(await search()).toHaveLength(3)
    expect(await search('Bob')).toEqual([{ id: 2 }])
  })

  it('a CTE through db.qb.with', async () => {
    const rows = await db.qb
      .with('recent', (q) =>
        q.selectFrom('posts').select(['authorId', 'title']).where('createdAt', '>=', 20),
      )
      .selectFrom('recent')
      .select('title')
      .orderBy('title')
      .execute()
    expect(rows.map((r) => r.title)).toEqual(['four', 'three', 'two'])
  })

  it('union', async () => {
    const rows = await db
      .selectFrom('users')
      .select('name as label')
      .where('id', '=', 2)
      .union(db.selectFrom('posts').select('title as label').where('id', '=', 1))
      .execute()
    expect(rows.map((r) => r.label).toSorted()).toEqual(['Bob', 'one'])
  })
})
