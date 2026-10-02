/**
 * D.19: `columns` and `extras` in relational reads, at every level.
 */
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { sql } from 'kysely'
import {
  createDbClient,
  diff,
  emitSqlite,
  extractSnapshot,
  integer,
  relations,
  serial,
  table,
  text,
} from '@forinda/kickjs-db'
import { sqliteDialect } from '@forinda/kickjs-db/sqlite'

const users = table('users', {
  id: serial().primaryKey(),
  email: text().notNull(),
  passwordHash: text().notNull(),
})
const posts = table('posts', {
  id: serial().primaryKey(),
  authorId: integer()
    .notNull()
    .references(() => users.id),
  title: text().notNull(),
  body: text().notNull(),
})
const userRelations = relations(users, ({ many }) => ({ posts: many(posts) }))
const postRelations = relations(posts, ({ one }) => ({
  author: one(users, { fields: [posts.authorId], references: [users.id] }),
}))
const schema = { users, posts, userRelations, postRelations }

async function make() {
  const database = new Database(':memory:')
  const empty = { version: 1 as const, dialect: 'sqlite' as const, tables: {} }
  const target = extractSnapshot(schema, 'sqlite')
  database.exec(emitSqlite(diff(empty, target), { from: empty, to: target }))
  const db = createDbClient({ schema, dialect: sqliteDialect({ database }) })
  await db.insertInto('users').values({ email: 'ada@x.io', passwordHash: 'secret' }).execute()
  await db
    .insertInto('posts')
    .values([
      { authorId: 1, title: 'One', body: 'long text' },
      { authorId: 1, title: 'Two', body: 'more text' },
    ])
    .execute()
  return db
}

describe('columns and extras in db.query', () => {
  it('leaves out excluded columns and adds computed fields, at every level', async () => {
    const db = await make()
    const user = await db.query.users.findFirst({
      columns: { passwordHash: false },
      extras: {
        postCount: (_u, eb) =>
          eb
            .selectFrom('posts')
            .select(eb.fn.countAll<number>().as('n'))
            .where('posts.authorId', '=', sql.ref<number>('users_0.id')),
        shout: () => sql<string>`upper(email)`,
      },
      with: {
        posts: {
          columns: { id: true, title: true },
          extras: { titleLength: () => sql<number>`length(title)` },
          orderBy: (_p, eb) => eb.ref('id'),
        },
      },
    })
    expect(user).toEqual({
      id: 1,
      email: 'ada@x.io',
      postCount: 2,
      shout: 'ADA@X.IO',
      posts: [
        { id: 1, title: 'One', titleLength: 3 },
        { id: 2, title: 'Two', titleLength: 3 },
      ],
    })
  })

  it('refuses a mix of true and false, an unknown column, and no columns at all', async () => {
    const db = await make()
    await expect(db.query.users.findMany({ columns: { id: true, email: false } })).rejects.toThrow(
      /mixes true and false/,
    )
    await expect(db.query.users.findMany({ columns: { nope: true } as never })).rejects.toThrow(
      /doesn't have/,
    )
    await expect(
      db.query.users.findMany({
        with: { posts: { columns: { id: false, authorId: false, title: false, body: false } } },
      }),
    ).rejects.toThrow(/leaves out every column/)
  })
})

describe('result extensions on db.query', () => {
  it('compute on related rows too, at every level', async () => {
    const db = (await make()).$extends({
      result: {
        users: {
          handle: { needs: { email: true }, compute: (u) => u.email.split('@')[0] },
        },
        posts: {
          slug: { needs: { title: true }, compute: (p) => p.title.toLowerCase() },
        },
      },
    })
    const posts = await db.query.posts.findMany({
      orderBy: (_p, eb) => eb.ref('id'),
      with: { author: { with: { posts: { columns: { id: true } } } } },
    })
    expect(posts[0]).toMatchObject({ slug: 'one', author: { handle: 'ada' } })
    // A nested row without the columns a computed needs is left without it.
    expect(posts[0].author!.posts).toEqual([{ id: 1 }, { id: 2 }])
    const users = await db.query.users.findMany({ with: { posts: true } })
    expect(users[0].handle).toBe('ada')
    expect(users[0].posts.map((p) => p.slug)).toEqual(['one', 'two'])
  })
})
