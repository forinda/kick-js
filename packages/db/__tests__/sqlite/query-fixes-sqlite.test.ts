/**
 * Relational reads and query plugins that returned wrong rows or failed: a
 * soft-deleted junction row, an ambiguous many-to-many `where`, an offset
 * with no limit, a nested blob, prototype names, managed columns inside a
 * WITH, and computed fields on a join.
 */
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  RelationalQueryUnknownRelationError,
  bytea,
  createDbClient,
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
const tags = table('tags', { id: serial().primaryKey(), name: text().notNull() })
const postTags = table(
  'post_tags',
  {
    id: integer().notNull(), // a column the target has too
    postId: integer()
      .notNull()
      .references(() => posts.id),
    tagId: integer()
      .notNull()
      .references(() => tags.id),
    deletedAt: timestamp().softDelete(),
  },
  (t) => ({ pk: primaryKey().on(t.postId, t.tagId) }),
)
const files = table('files', {
  id: serial().primaryKey(),
  postId: integer().notNull(),
  name: text().notNull(),
  body: bytea(),
})
const docs = table('docs', {
  id: serial().primaryKey(),
  title: text().notNull(),
  updatedAt: timestamp().onUpdateNow(),
})
const postRelations = relations(posts, ({ many }) => ({
  tags: many(tags, { through: postTags }),
  files: many(files),
  // A name Object.prototype has too.
  constructor: many(files),
}))
const fileRelations = relations(files, ({ one }) => ({
  post: one(posts, { fields: [files.postId], references: [posts.id] }),
}))
const schema = { posts, tags, postTags, files, docs, postRelations, fileRelations }

function make() {
  const database = new Database(':memory:')
  const empty = { version: 1 as const, dialect: 'sqlite' as const, tables: {} }
  const target = extractSnapshot(schema, 'sqlite')
  database.exec(emitSqlite(diff(empty, target), { from: empty, to: target }))
  database.exec(`
    INSERT INTO posts (title) VALUES ('a'), ('b'), ('c');
    INSERT INTO tags (name) VALUES ('t1'), ('t2');
    INSERT INTO post_tags (id, postId, tagId, deletedAt) VALUES (1, 1, 1, NULL), (2, 1, 2, '2026-01-01');
    INSERT INTO files (postId, name, body) VALUES (1, 'f', x'0102');
    INSERT INTO docs (title) VALUES ('d');
  `)
  return { db: createDbClient({ schema, dialect: sqliteDialect({ database }) }), database }
}

describe('relational reads', () => {
  it('a soft-deleted junction row links nothing, unless the level asks for deleted rows', async () => {
    const { db } = make()
    const one = (opts: object) =>
      db.query.posts.findFirst({
        where: (_p, eb) => eb('id', '=', 1),
        with: { tags: opts as never },
      })
    expect((await one(true))!.tags.map((t) => t.name)).toEqual(['t1'])
    expect((await one({ withDeleted: true }))!.tags.map((t) => t.name)).toEqual(['t1', 't2'])
  })

  it("a many-to-many level's where names its own columns, even ones the junction has too", async () => {
    const { db } = make()
    const post = await db.query.posts.findFirst({
      where: (_p, eb) => eb('id', '=', 1),
      with: { tags: { where: (_t, eb) => eb('id', '=', 1) } },
    })
    expect(post!.tags.map((t) => t.name)).toEqual(['t1'])
  })

  it('takes an offset without a limit, at the top and nested', async () => {
    const { db } = make()
    const rows = await db.query.posts.findMany({
      orderBy: (_p, eb) => eb.ref('id'),
      offset: 1,
      with: { files: { offset: 0, columns: { name: true } } },
    })
    expect(rows.map((p) => p.title)).toEqual(['b', 'c'])
  })

  it("names a nested bytea column it can't put in JSON, and loads without it", async () => {
    const { db } = make()
    await expect(db.query.posts.findMany({ with: { files: true } })).rejects.toThrow(
      /files\.body is a bytea column.*columns: \{ body: false \}/,
    )
    const rows = await db.query.posts.findMany({
      where: (_p, eb) => eb('id', '=', 1),
      with: { files: { columns: { body: false } } },
    })
    expect(rows[0]!.files).toEqual([{ id: 1, postId: 1, name: 'f' }])
    // The top level reads it as usual.
    expect((await db.query.files.findFirst())!.body).toEqual(Buffer.from([1, 2]))
  })

  it("treats Object.prototype's names as names", async () => {
    const { db } = make()
    // `constructor` is a relation here, not a collision with a column.
    const rows = await db.query.posts.findMany({
      where: (_p, eb) => eb('id', '=', 1),
      with: { constructor: { columns: { name: true } } } as never,
    })
    expect((rows[0] as unknown as { constructor: unknown }).constructor).toEqual([{ name: 'f' }])
    await expect(db.query.posts.findMany({ with: { toString: true } as never })).rejects.toThrow(
      RelationalQueryUnknownRelationError,
    )
  })
})

describe('query plugins', () => {
  it('sets managed columns on an update inside a WITH', () => {
    const { db } = make()
    const compiled = db
      .with('changed', (qb) => qb.updateTable('docs').set({ title: 'e' }).returning('id'))
      .selectFrom('changed')
      .selectAll()
      .compile()
    expect(compiled.sql).toMatch(/update "docs" set "title" = \?, "updatedAt" = \?/)
  })

  it("computes fields on a join only when the row has what they need, and doesn't make the query ambiguous", async () => {
    const { db } = make()
    const dbX = db.$extends({
      result: {
        posts: { slug: { needs: { title: true }, compute: (p) => p.title.toUpperCase() } },
      },
    })
    const rows = await dbX
      .selectFrom('posts')
      .innerJoin('files', 'files.postId', 'posts.id')
      .select(['posts.id', 'files.name'])
      .execute()
    expect(rows).toEqual([{ id: 1, name: 'f' }])
    const withTitle = await dbX
      .selectFrom('posts')
      .innerJoin('files', 'files.postId', 'posts.id')
      .select(['posts.title', 'files.name'])
      .execute()
    expect(withTitle).toEqual([{ title: 'a', name: 'f', slug: 'A' }])
  })
})

describe("$extends under casing: 'snake_case' and .colName()", () => {
  it('finds the table by its key and adds needed columns by their database names', async () => {
    const blogPosts = table('blogPosts', {
      id: serial().primaryKey(),
      fullTitle: text().notNull(),
      authorId: integer().notNull(),
    })
    const authors = table('authors', {
      id: serial().primaryKey(),
      displayName: text().colName('DISPLAY').notNull(),
    })
    const rel = relations(blogPosts, ({ one }) => ({
      author: one(authors, { fields: [blogPosts.authorId], references: [authors.id] }),
    }))
    const s = { blogPosts, authors, rel }
    const database = new Database(':memory:')
    const empty = { version: 1 as const, dialect: 'sqlite' as const, tables: {} }
    const t = extractSnapshot(s, 'sqlite', { casing: 'snake_case' })
    database.exec(emitSqlite(diff(empty, t), { from: empty, to: t }))
    database.exec(`INSERT INTO authors (DISPLAY) VALUES ('Ada');
      INSERT INTO blog_posts (full_title, author_id) VALUES ('Hi', 1);`)
    const db = createDbClient({
      schema: s,
      dialect: sqliteDialect({ database }),
      casing: 'snake_case',
    }).$extends({
      result: {
        blogPosts: {
          shout: { needs: { fullTitle: true }, compute: (p) => p.fullTitle.toUpperCase() },
        },
        authors: { handle: { needs: { displayName: true }, compute: (a) => `@${a.displayName}` } },
      },
    })
    expect(await db.selectFrom('blogPosts').select('id').execute()).toEqual([
      { id: 1, fullTitle: 'Hi', shout: 'HI' },
    ])
    expect(await db.selectFrom('authors').select('id').execute()).toEqual([
      { id: 1, displayName: 'Ada', handle: '@Ada' },
    ])
    const [post] = await db.query.blogPosts.findMany({ with: { author: true } })
    expect(post).toMatchObject({ shout: 'HI', author: { displayName: 'Ada', handle: '@Ada' } })
  })
})
