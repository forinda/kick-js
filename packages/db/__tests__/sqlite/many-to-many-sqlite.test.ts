/**
 * Many-to-many relational reads (D.13): `many(target, { through: junction })`.
 */
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  RelationalQueryThroughError,
  createDbClient,
  desc,
  diff,
  emitSqlite,
  extractSnapshot,
  integer,
  primaryKey,
  relations,
  serial,
  table,
  text,
  timestamp,
} from '@forinda/kickjs-db'
import { sqliteDialect } from '@forinda/kickjs-db/sqlite'

const posts = table('posts', { id: serial().primaryKey(), title: text().notNull() })
const tags = table('tags', {
  id: serial().primaryKey(),
  name: text().notNull(),
  deletedAt: timestamp().softDelete(),
})
const postTags = table(
  'post_tags',
  {
    postId: integer()
      .notNull()
      .references(() => posts.id),
    tagId: integer()
      .notNull()
      .references(() => tags.id),
  },
  (t) => ({ pk: primaryKey().on(t.postId, t.tagId) }),
)
const users = table('users', { id: serial().primaryKey(), name: text().notNull() })
const follows = table(
  'follows',
  {
    followerId: integer()
      .notNull()
      .references(() => users.id),
    followeeId: integer()
      .notNull()
      .references(() => users.id),
  },
  (t) => ({ pk: primaryKey().on(t.followerId, t.followeeId) }),
)

const postRelations = relations(posts, ({ many }) => ({ tags: many(tags, { through: postTags }) }))
const tagRelations = relations(tags, ({ many }) => ({ posts: many(posts, { through: postTags }) }))
const userRelations = relations(users, ({ many }) => ({
  following: many(users, {
    through: { table: follows, from: [follows.followerId], to: [follows.followeeId] },
  }),
  followers: many(users, {
    through: { table: follows, from: [follows.followeeId], to: [follows.followerId] },
  }),
}))
const schema = { posts, tags, postTags, users, follows, postRelations, tagRelations, userRelations }

async function make() {
  const database = new Database(':memory:')
  const empty = { version: 1 as const, dialect: 'sqlite' as const, tables: {} }
  const target = extractSnapshot(schema, 'sqlite')
  database.exec(emitSqlite(diff(empty, target), { from: empty, to: target }))
  const db = createDbClient({ schema, dialect: sqliteDialect({ database }) })
  for (const title of ['First', 'Second']) await db.insertInto('posts').values({ title }).execute()
  for (const name of ['db', 'sql', 'old']) await db.insertInto('tags').values({ name }).execute()
  await db.updateTable('tags').set({ deletedAt: new Date() }).where('name', '=', 'old').execute()
  for (const [postId, tagId] of [
    [1, 1],
    [1, 2],
    [1, 3],
    [2, 2],
  ]) {
    await db.insertInto('post_tags').values({ postId: postId!, tagId: tagId! }).execute()
  }
  for (const name of ['ada', 'bob', 'cy']) await db.insertInto('users').values({ name }).execute()
  // ada follows bob and cy; bob follows ada.
  for (const [followerId, followeeId] of [
    [1, 2],
    [1, 3],
    [2, 1],
  ]) {
    await db
      .insertInto('follows')
      .values({ followerId: followerId!, followeeId: followeeId! })
      .execute()
  }
  return db
}

describe('many-to-many on SQLite', () => {
  it('reads through the junction in both directions', async () => {
    const db = await make()
    const first = await db.query.posts.findFirst({
      where: (_p, eb) => eb('id', '=', 1),
      with: { tags: { orderBy: (_t, eb) => eb.ref('name') } },
    })
    // 'old' is soft-deleted, so it's skipped.
    expect(first!.tags.map((t) => t.name)).toEqual(['db', 'sql'])

    const sql = await db.query.tags.findFirst({
      where: (_t, eb) => eb('name', '=', 'sql'),
      with: { posts: { orderBy: (_p, eb) => eb.ref('id') } },
    })
    expect(sql!.posts.map((p) => p.title)).toEqual(['First', 'Second'])
  })

  it('takes where, orderBy and limit, and nests', async () => {
    const db = await make()
    const first = await db.query.posts.findFirst({
      where: (_p, eb) => eb('id', '=', 1),
      with: {
        tags: {
          where: (_t, eb) => eb('name', '!=', 'db'),
          orderBy: (_t, eb) => desc(eb.ref('name')),
          limit: 1,
          withDeleted: true,
          with: { posts: true },
        },
      },
    })
    expect(first!.tags.map((t) => t.name)).toEqual(['sql'])
    expect(first!.tags[0]!.posts.map((p) => p.title).toSorted()).toEqual(['First', 'Second'])
  })

  it('joins a table to itself with named junction columns', async () => {
    const db = await make()
    const ada = await db.query.users.findFirst({
      where: (_u, eb) => eb('name', '=', 'ada'),
      with: { following: { orderBy: (_u, eb) => eb.ref('id') }, followers: true },
    })
    expect(ada!.following.map((u) => u.name)).toEqual(['bob', 'cy'])
    expect(ada!.followers.map((u) => u.name)).toEqual(['bob'])
  })

  it('explains a junction it cannot resolve', () => {
    const selfImplicit = relations(users, ({ many }) => ({
      friends: many(users, { through: follows }),
    }))
    expect(() =>
      createDbClient({
        schema: { users, follows, selfImplicit },
        dialect: sqliteDialect({ database: new Database(':memory:') }),
      }),
    ).toThrow(RelationalQueryThroughError)

    const wrongColumns = relations(posts, ({ many }) => ({
      tags: many(tags, {
        through: { table: postTags, from: [postTags.tagId], to: [postTags.postId] },
      }),
    }))
    expect(() =>
      createDbClient({
        schema: { posts, tags, postTags, wrongColumns },
        dialect: sqliteDialect({ database: new Database(':memory:') }),
      }),
    ).toThrow(/is not a foreign key to posts/)
  })
})
