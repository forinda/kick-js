/**
 * Rows `db.query` nests under a relation decode like top-level rows: dates
 * as `Date`, custom types through their codec — on every level.
 */
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  createDbClient,
  customType,
  decimal,
  diff,
  emitSqlite,
  extractSnapshot,
  integer,
  relations,
  serial,
  table,
  text,
  timestamp,
} from '@forinda/kickjs-db'
import { sqliteDialect } from '@forinda/kickjs-db/sqlite'

const tagList = customType<string[]>({
  dataType: () => 'text',
  toDriver: (tags) => JSON.stringify(tags),
  fromDriver: (stored) => JSON.parse(stored as string) as string[],
})

const authors = table('authors', { id: serial().primaryKey(), name: text().notNull() })
const posts = table('posts', {
  id: serial().primaryKey(),
  authorId: integer()
    .notNull()
    .references(() => authors.id),
  tags: tagList().notNull(),
  price: decimal(8, 2),
  publishedAt: timestamp().notNull(),
})
const comments = table('comments', {
  id: serial().primaryKey(),
  postId: integer()
    .notNull()
    .references(() => posts.id),
  createdAt: timestamp().notNull().defaultNow(),
})
const authorRelations = relations(authors, ({ many }) => ({ posts: many(posts) }))
const postRelations = relations(posts, ({ one, many }) => ({
  author: one(authors, { fields: [posts.authorId], references: [authors.id] }),
  comments: many(comments),
}))
const commentRelations = relations(comments, ({ one }) => ({
  post: one(posts, { fields: [comments.postId], references: [posts.id] }),
}))
const schema = { authors, posts, comments, authorRelations, postRelations, commentRelations }

async function seeded() {
  const database = new Database(':memory:')
  const empty = { version: 1 as const, dialect: 'sqlite' as const, tables: {} }
  const target = extractSnapshot(schema, 'sqlite')
  database.exec(emitSqlite(diff(empty, target), { from: empty, to: target }))
  const db = createDbClient({ schema, dialect: sqliteDialect({ database }) })
  await db.insertInto('authors').values({ name: 'Ada' }).execute()
  await db
    .insertInto('posts')
    .values({
      authorId: 1,
      tags: ['db', 'sqlite'],
      price: '9.50',
      publishedAt: new Date('2026-01-02T03:04:05Z'),
    })
    .execute()
  await db.insertInto('comments').values({ postId: 1 }).execute()
  return db
}

describe('nested rows from db.query on SQLite', () => {
  it('decode a many relation, and the one nested inside it', async () => {
    const db = await seeded()
    const author = await db.query.authors.findFirst({
      with: { posts: { with: { comments: true } } },
    })

    const post = author!.posts[0]!
    expect(post.tags).toEqual(['db', 'sqlite'])
    expect(post.price).toBe('9.50')
    expect(post.publishedAt).toEqual(new Date('2026-01-02T03:04:05Z'))
    expect(post.comments[0]!.createdAt).toBeInstanceOf(Date)
  })

  it('decode a one relation', async () => {
    const db = await seeded()
    const comment = await db.query.comments.findFirst({ with: { post: true } })
    expect(comment!.post!.tags).toEqual(['db', 'sqlite'])
    expect(comment!.post!.publishedAt).toBeInstanceOf(Date)
  })
})
