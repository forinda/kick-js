/**
 * Every relation shape the Relations guide shows, on one blog schema, with
 * the results the guide prints.
 */
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  createDbClient,
  diff,
  emitSqlite,
  extractSnapshot,
  index,
  integer,
  primaryKey,
  relations,
  serial,
  table,
  text,
  unique,
  varchar,
} from '@forinda/kickjs-db'
import { sqliteDialect } from '@forinda/kickjs-db/sqlite'

const users = table('users', { id: serial().primaryKey(), name: text().notNull() })
const profiles = table('profiles', {
  id: serial().primaryKey(),
  userId: integer()
    .notNull()
    .unique()
    .references(() => users.id),
  bio: text().notNull(),
})
const posts = table('posts', {
  id: serial().primaryKey(),
  authorId: integer()
    .notNull()
    .references(() => users.id),
  title: text().notNull(),
})
const tags = table('tags', { id: serial().primaryKey(), name: text().notNull() })
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
const podcasts = table('podcasts', { id: serial().primaryKey(), title: text().notNull() })
const comments = table(
  'comments',
  {
    id: serial().primaryKey(),
    subjectType: varchar(50).notNull(),
    subjectId: integer().notNull(),
    body: text().notNull(),
  },
  (t) => ({ subject: index('comments_subject_idx').on(t.subjectType, t.subjectId) }),
)
const images = table(
  'images',
  {
    id: serial().primaryKey(),
    subjectType: varchar(50).notNull(),
    subjectId: integer().notNull(),
    url: text().notNull(),
  },
  (t) => ({ subject: unique('images_subject_unique').on(t.subjectType, t.subjectId) }),
)

const userRelations = relations(users, ({ one, many }) => ({
  posts: many(posts),
  profile: one(profiles, { fields: [users.id], references: [profiles.userId] }),
}))
const profileRelations = relations(profiles, ({ one }) => ({
  user: one(users, { fields: [profiles.userId], references: [users.id] }),
}))
const postRelations = relations(posts, ({ one, many, morphMany, morphOne }) => ({
  author: one(users, { fields: [posts.authorId], references: [users.id] }),
  tags: many(tags, { through: postTags }),
  comments: morphMany(comments, { type: comments.subjectType, id: comments.subjectId, as: 'post' }),
  cover: morphOne(images, { type: images.subjectType, id: images.subjectId, as: 'post' }),
}))
const tagRelations = relations(tags, ({ many }) => ({
  posts: many(posts, { through: postTags }),
}))
const podcastRelations = relations(podcasts, ({ morphMany }) => ({
  comments: morphMany(comments, {
    type: comments.subjectType,
    id: comments.subjectId,
    as: 'podcast',
  }),
}))
const commentRelations = relations(comments, ({ morphTo }) => ({
  subject: morphTo({
    type: comments.subjectType,
    id: comments.subjectId,
    targets: { post: posts, podcast: podcasts },
  }),
}))

const schema = {
  users,
  profiles,
  posts,
  tags,
  postTags,
  podcasts,
  comments,
  images,
  userRelations,
  profileRelations,
  postRelations,
  tagRelations,
  podcastRelations,
  commentRelations,
}

async function seeded() {
  const database = new Database(':memory:')
  const empty = { version: 1 as const, dialect: 'sqlite' as const, tables: {} }
  const target = extractSnapshot(schema, 'sqlite')
  database.exec(emitSqlite(diff(empty, target), { from: empty, to: target }))
  const db = createDbClient({ schema, dialect: sqliteDialect({ database }) })
  await db
    .insertInto('users')
    .values([{ name: 'Ada' }, { name: 'Linus' }])
    .execute()
  await db.insertInto('profiles').values({ userId: 1, bio: 'Writes about engines' }).execute()
  await db
    .insertInto('posts')
    .values([
      { authorId: 1, title: 'Hello' },
      { authorId: 1, title: 'Indexes' },
    ])
    .execute()
  await db
    .insertInto('tags')
    .values([{ name: 'intro' }, { name: 'sql' }])
    .execute()
  await db
    .insertInto('post_tags')
    .values([
      { postId: 1, tagId: 1 },
      { postId: 1, tagId: 2 },
      { postId: 2, tagId: 2 },
    ])
    .execute()
  await db.insertInto('podcasts').values({ title: 'Weekly' }).execute()
  await db
    .insertInto('comments')
    .values([
      { subjectType: 'post', subjectId: 1, body: 'Nice' },
      { subjectType: 'podcast', subjectId: 1, body: 'Great episode' },
      { subjectType: 'post', subjectId: 1, body: 'Agreed' },
    ])
    .execute()
  await db
    .insertInto('images')
    .values({ subjectType: 'post', subjectId: 1, url: '/hello.png' })
    .execute()
  return db
}

describe('relation kinds, as the Relations guide shows them', () => {
  it('many-to-one: a post and its author', async () => {
    const db = await seeded()
    const post = await db.query.posts.findFirst({
      where: (_p, eb) => eb('id', '=', 1),
      columns: { title: true },
      with: { author: { columns: { name: true } } },
    })
    expect(post).toEqual({ title: 'Hello', author: { name: 'Ada' } })
  })

  it('one-to-many: users and their posts, empty for none', async () => {
    const db = await seeded()
    const rows = await db.query.users.findMany({
      columns: { name: true },
      with: { posts: { columns: { title: true }, orderBy: (_p, eb) => eb.ref('id') } },
    })
    expect(rows).toEqual([
      { name: 'Ada', posts: [{ title: 'Hello' }, { title: 'Indexes' }] },
      { name: 'Linus', posts: [] },
    ])
  })

  it('one-to-one: users and their profile, null for none', async () => {
    const db = await seeded()
    const rows = await db.query.users.findMany({
      columns: { name: true },
      with: { profile: { columns: { bio: true } } },
    })
    expect(rows).toEqual([
      { name: 'Ada', profile: { bio: 'Writes about engines' } },
      { name: 'Linus', profile: null },
    ])
  })

  it('many-to-many: tags of a post, posts of a tag', async () => {
    const db = await seeded()
    const post = await db.query.posts.findFirst({
      where: (_p, eb) => eb('id', '=', 1),
      columns: { title: true },
      with: { tags: { columns: { name: true }, orderBy: (_t, eb) => eb.ref('name') } },
    })
    expect(post).toEqual({ title: 'Hello', tags: [{ name: 'intro' }, { name: 'sql' }] })
    const tag = await db.query.tags.findFirst({
      where: (_t, eb) => eb('name', '=', 'sql'),
      columns: { name: true },
      with: { posts: { columns: { title: true }, orderBy: (_p, eb) => eb.ref('id') } },
    })
    expect(tag).toEqual({ name: 'sql', posts: [{ title: 'Hello' }, { title: 'Indexes' }] })
  })

  it('morphMany: comments of a post only', async () => {
    const db = await seeded()
    const post = await db.query.posts.findFirst({
      where: (_p, eb) => eb('id', '=', 1),
      columns: { title: true },
      with: { comments: { columns: { body: true }, orderBy: (_c, eb) => eb.ref('id') } },
    })
    expect(post).toEqual({ title: 'Hello', comments: [{ body: 'Nice' }, { body: 'Agreed' }] })
  })

  it('morphOne: a post cover, null for none', async () => {
    const db = await seeded()
    const rows = await db.query.posts.findMany({
      columns: { title: true },
      with: { cover: { columns: { url: true } } },
      orderBy: (_p, eb) => eb.ref('id'),
    })
    expect(rows).toEqual([
      { title: 'Hello', cover: { url: '/hello.png' } },
      { title: 'Indexes', cover: null },
    ])
    // The unique key on the pair is what keeps it one-to-one.
    await expect(
      db
        .insertInto('images')
        .values({ subjectType: 'post', subjectId: 1, url: '/again.png' })
        .execute(),
    ).rejects.toThrow(/Duplicate value for images/)
  })

  it('morphTo: each comment and its subject, of either kind', async () => {
    const db = await seeded()
    const rows = await db.query.comments.findMany({
      columns: { body: true },
      with: { subject: true },
      orderBy: (_c, eb) => eb.ref('id'),
    })
    expect(rows).toEqual([
      { body: 'Nice', subject: { id: 1, authorId: 1, title: 'Hello', __type: 'post' } },
      { body: 'Great episode', subject: { id: 1, title: 'Weekly', __type: 'podcast' } },
      { body: 'Agreed', subject: { id: 1, authorId: 1, title: 'Hello', __type: 'post' } },
    ])
  })
})
