/**
 * Polymorphic one-to-many: `morphMany(target, { type, id, as })` — one
 * `comments` table shared by posts and podcasts through a `(type, id)` pair.
 */
import 'reflect-metadata'
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { Kysely, SqliteDialect } from 'kysely'
import {
  createDbClient,
  defineTenancy,
  desc,
  diff,
  emitSqlite,
  extractSnapshot,
  index,
  integer,
  primaryKey,
  relations,
  serial,
  table,
  tenantKey,
  text,
  timestamp,
} from '@forinda/kickjs-db'
import { sqliteDialect } from '@forinda/kickjs-db/sqlite'
import { compileSqlite } from '../../src/query/compile-sqlite'
import { extractRelations } from '../../src/query/extract-relations'

const posts = table('posts', { id: serial().primaryKey(), title: text().notNull() })
const podcasts = table('podcasts', { id: serial().primaryKey(), title: text().notNull() })
const comments = table(
  'comments',
  {
    id: serial().primaryKey(),
    subjectType: text().notNull(),
    subjectId: integer().notNull(),
    body: text().notNull(),
    deletedAt: timestamp().softDelete(),
  },
  (t) => ({ subject: index('comments_subject_idx').on(t.subjectType, t.subjectId) }),
)
const reactions = table('reactions', {
  id: serial().primaryKey(),
  commentId: integer()
    .notNull()
    .references(() => comments.id),
  emoji: text().notNull(),
})
const postRelations = relations(posts, ({ morphMany }) => ({
  comments: morphMany(comments, { type: comments.subjectType, id: comments.subjectId, as: 'post' }),
}))
const podcastRelations = relations(podcasts, ({ morphMany }) => ({
  comments: morphMany(comments, {
    type: comments.subjectType,
    id: comments.subjectId,
    as: 'podcast',
  }),
}))
const commentRelations = relations(comments, ({ many }) => ({ reactions: many(reactions) }))
const reactionRelations = relations(reactions, ({ one }) => ({
  comment: one(comments, { fields: [reactions.commentId], references: [comments.id] }),
}))
const schema = {
  posts,
  podcasts,
  comments,
  reactions,
  postRelations,
  podcastRelations,
  commentRelations,
  reactionRelations,
}

async function make() {
  const database = new Database(':memory:')
  const empty = { version: 1 as const, dialect: 'sqlite' as const, tables: {} }
  const target = extractSnapshot(schema, 'sqlite')
  database.exec(emitSqlite(diff(empty, target), { from: empty, to: target }))
  const db = createDbClient({ schema, dialect: sqliteDialect({ database }) })
  await db.insertInto('posts').values({ title: 'Hello' }).execute() // id 1
  await db.insertInto('posts').values({ title: 'Quiet' }).execute() // id 2
  await db.insertInto('podcasts').values({ title: 'Episode 1' }).execute() // id 1 — same as a post
  for (const [subjectType, subjectId, body] of [
    ['post', 1, 'first!'],
    ['post', 1, 'nice post'],
    ['post', 1, 'spam'],
    ['podcast', 1, 'great episode'], // same id as post 1 — must not show on it
  ] as const) {
    await db.insertInto('comments').values({ subjectType, subjectId, body }).execute()
  }
  await db
    .updateTable('comments')
    .set({ deletedAt: new Date() })
    .where('body', '=', 'spam')
    .execute()
  await db.insertInto('reactions').values({ commentId: 1, emoji: '+1' }).execute()
  return { db, target }
}

describe('morphMany on SQLite', () => {
  it("loads each parent's rows by type and id — another type with the same id stays out", async () => {
    const { db } = await make()
    const rows = await db.query.posts.findMany({
      orderBy: (_p, eb) => eb.ref('id'),
      with: { comments: { orderBy: (_c, eb) => eb.ref('id') } },
    })
    // 'spam' is soft-deleted; the podcast's comment has subjectId 1 too.
    expect(rows.map((p) => [p.title, p.comments.map((c) => c.body)])).toEqual([
      ['Hello', ['first!', 'nice post']],
      ['Quiet', []],
    ])
    const pods = await db.query.podcasts.findMany({ with: { comments: true } })
    expect(pods[0]!.comments.map((c) => c.body)).toEqual(['great episode'])
    // Typed like `many`: an array of comment rows.
    const body: string = rows[0]!.comments[0]!.body
    expect(body).toBe('first!')
  })

  it('takes where, orderBy, limit, columns, withDeleted and nested with', async () => {
    const { db } = await make()
    const post = await db.query.posts.findFirst({
      where: (_p, eb) => eb('id', '=', 1),
      with: {
        comments: {
          where: (_c, eb) => eb('body', '!=', 'nice post'),
          orderBy: (_c, eb) => desc(eb.ref('id')),
          limit: 2,
          withDeleted: true,
          columns: { id: true, body: true },
          with: { reactions: true },
        },
      },
    })
    expect(post!.comments).toEqual([
      { id: 3, body: 'spam', reactions: [] },
      { id: 1, body: 'first!', reactions: [expect.objectContaining({ emoji: '+1' })] },
    ])
  })

  it('binds `as` as a parameter, never as SQL', async () => {
    const { target } = await make()
    const evil = "post' OR 1=1 --"
    const evilRelations = relations(posts, ({ morphMany }) => ({
      comments: morphMany(comments, {
        type: comments.subjectType,
        id: comments.subjectId,
        as: evil,
      }),
    }))
    const resolved = extractRelations({ posts, comments, evilRelations }, target.tables)!
    const kysely = new Kysely<any>({ dialect: new SqliteDialect({ database: new Database() }) })
    const compiled = compileSqlite(
      kysely,
      'posts',
      { with: { comments: true } },
      resolved,
      target.tables,
      'many',
    )
    expect(compiled.sql).not.toContain(evil)
    expect(compiled.parameters).toContain(evil)
  })

  it('creates no foreign key for the (type, id) pair', async () => {
    const { target } = await make()
    expect(target.tables.comments!.foreignKeys).toEqual([])
    expect(target.relations!.posts!.comments).toEqual({
      kind: 'many',
      target: 'comments',
      sourceColumns: ['id'],
      targetColumns: ['subjectId'],
      morph: { column: 'subjectType', value: 'post' },
    })
  })

  it('needs `references` when the source key is composite, and checks the columns', () => {
    const pairs = table('pairs', { a: integer().notNull(), b: integer().notNull() }, (t) => ({
      pk: primaryKey().on(t.a, t.b),
    }))
    const open = (rel: unknown) =>
      createDbClient({
        schema: { pairs, posts, comments, rel },
        dialect: sqliteDialect({ database: new Database(':memory:') }),
      })
    expect(() =>
      open(
        relations(pairs, ({ morphMany }) => ({
          comments: morphMany(comments, {
            type: comments.subjectType,
            id: comments.subjectId,
            as: 'pair',
          }),
        })),
      ),
    ).toThrow(/composite primary key — name the key column with `references`/)
    expect(() =>
      open(
        relations(pairs, ({ morphMany }) => ({
          comments: morphMany(comments, {
            type: comments.subjectType,
            id: comments.subjectId,
            as: 'pair',
            references: pairs.a,
          }),
        })),
      ),
    ).not.toThrow()
    expect(() =>
      open(
        relations(posts, ({ morphMany }) => ({
          comments: morphMany(comments, { type: posts.title, id: comments.subjectId, as: 'post' }),
        })),
      ),
    ).toThrow(/'title' is not a column of the target table 'comments'/)
  })
})

describe('morphMany with casing, .colName() and tenancy', () => {
  it('maps snake_case and .colName() columns', async () => {
    const notes = table('notes', {
      id: serial().primaryKey(),
      subjectType: text().notNull().colName('KIND'),
      subjectId: integer().notNull(),
      body: text().notNull(),
    })
    const blogPosts = table('blogPosts', { id: serial().primaryKey(), title: text().notNull() })
    const rel = relations(blogPosts, ({ morphMany }) => ({
      notes: morphMany(notes, { type: notes.subjectType, id: notes.subjectId, as: 'blogPost' }),
    }))
    const s = { notes, blogPosts, rel }
    const database = new Database(':memory:')
    const empty = { version: 1 as const, dialect: 'sqlite' as const, tables: {} }
    const target = extractSnapshot(s, 'sqlite', { casing: 'snake_case' })
    expect(Object.keys(target.tables.notes!.columns)).toEqual(['id', 'KIND', 'subject_id', 'body'])
    database.exec(emitSqlite(diff(empty, target), { from: empty, to: target }))
    database.exec(`
      INSERT INTO blog_posts (title) VALUES ('A');
      INSERT INTO notes (KIND, subject_id, body) VALUES ('blogPost', 1, 'mine'), ('video', 1, 'not mine');
    `)
    const db = createDbClient({
      schema: s,
      dialect: sqliteDialect({ database }),
      casing: 'snake_case',
    })
    const rows = await db.query.blogPosts.findMany({ with: { notes: true } })
    expect(rows[0]!.notes).toEqual([{ id: 1, subjectType: 'blogPost', subjectId: 1, body: 'mine' }])
  })

  it("keeps 'column' tenancy on the related rows", async () => {
    const tenancy = defineTenancy({ strategy: 'column', current: () => undefined })
    const articles = table('articles', {
      id: serial().primaryKey(),
      tenantId: tenantKey(tenancy),
      title: text().notNull(),
    })
    const notes = table('notes', {
      id: serial().primaryKey(),
      tenantId: tenantKey(tenancy),
      subjectType: text().notNull(),
      subjectId: integer().notNull(),
      body: text().notNull(),
    })
    const rel = relations(articles, ({ morphMany }) => ({
      notes: morphMany(notes, { type: notes.subjectType, id: notes.subjectId, as: 'article' }),
    }))
    const s = { articles, notes, rel }
    const database = new Database(':memory:')
    const empty = { version: 1 as const, dialect: 'sqlite' as const, tables: {} }
    const target = extractSnapshot(s, 'sqlite')
    database.exec(emitSqlite(diff(empty, target), { from: empty, to: target }))
    database.exec(`
      INSERT INTO articles (id, tenantId, title) VALUES (1, 'acme', 'A');
      INSERT INTO notes (tenantId, subjectType, subjectId, body) VALUES
        ('acme', 'article', 1, 'ours'), ('globex', 'article', 1, 'planted by globex');
    `)
    const db = createDbClient({ schema: s, tenancy, dialect: sqliteDialect({ database }) })
    const rows = await tenancy.run('acme', () =>
      db.query.articles.findMany({ with: { notes: true } }),
    )
    expect(rows[0]!.notes.map((n) => n.body)).toEqual(['ours'])
  })
})
