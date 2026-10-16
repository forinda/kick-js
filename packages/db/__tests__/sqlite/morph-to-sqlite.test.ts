/**
 * Polymorphic belongs-to: `morphTo({ type, id, targets })` — a comment's
 * subject, in whichever table its type column names.
 */
import 'reflect-metadata'
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { Kysely, SqliteDialect } from 'kysely'
import {
  createDbClient,
  defineTenancy,
  diff,
  emitSqlite,
  extractSnapshot,
  bytea,
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
import { unsigned } from '../../src/dsl/columns/mysql'
import { compileSqlite } from '../../src/query/compile-sqlite'
import { extractRelations } from '../../src/query/extract-relations'

const posts = table('posts', {
  id: serial().primaryKey(),
  title: text().notNull(),
  deletedAt: timestamp().softDelete(),
})
const podcasts = table('podcasts', { id: serial().primaryKey(), name: text().notNull() })
const comments = table('comments', {
  id: serial().primaryKey(),
  subjectType: text().notNull(),
  subjectId: integer().notNull(),
  body: text().notNull(),
})
const commentRelations = relations(comments, ({ morphTo }) => ({
  subject: morphTo({
    type: comments.subjectType,
    id: comments.subjectId,
    targets: { post: posts, podcast: podcasts },
  }),
}))
const schema = { posts, podcasts, comments, commentRelations }

function open(s: Record<string, unknown>, casing?: 'snake_case') {
  const database = new Database(':memory:')
  const empty = { version: 1 as const, dialect: 'sqlite' as const, tables: {} }
  const target = extractSnapshot(s, 'sqlite', casing ? { casing } : undefined)
  database.exec(emitSqlite(diff(empty, target), { from: empty, to: target }))
  return { database, target }
}

async function make() {
  const { database, target } = open(schema)
  database.exec(`
    INSERT INTO posts (title) VALUES ('Hello'), ('Gone');
    UPDATE posts SET deletedAt = '2026-01-01' WHERE title = 'Gone';
    INSERT INTO podcasts (name) VALUES ('Episode 1');
    INSERT INTO comments (subjectType, subjectId, body) VALUES
      ('post', 1, 'on a post'),
      ('podcast', 1, 'on a podcast'),
      ('post', 2, 'on a deleted post'),
      ('video', 1, 'on an unknown type');
  `)
  const db = createDbClient({ schema, dialect: sqliteDialect({ database }) })
  return { db, target }
}

describe('morphTo on SQLite', () => {
  it("loads each row's subject from the table its type names, or null", async () => {
    const { db } = await make()
    const rows = await db.query.comments.findMany({
      orderBy: (_c, eb) => eb.ref('id'),
      with: { subject: true },
    })
    expect(rows.map((c) => [c.body, c.subject])).toEqual([
      ['on a post', { id: 1, title: 'Hello', deletedAt: null }],
      ['on a podcast', { id: 1, name: 'Episode 1' }],
      ['on a deleted post', null], // soft-deleted
      ['on an unknown type', null], // no target for 'video'
    ])
  })

  it('takes withDeleted, and refuses options that need one table', async () => {
    const { db } = await make()
    const rows = await db.query.comments.findMany({
      where: (_c, eb) => eb('id', '=', 3),
      with: { subject: { withDeleted: true } },
    })
    expect(rows[0]!.subject).toMatchObject({ id: 2, title: 'Gone' })
    await expect(
      db.query.comments.findMany({ with: { subject: { limit: 1 } as never } }),
    ).rejects.toThrow(/morphTo 'subject' takes `true` or `\{ withDeleted \}`.*\(got limit\)/)
  })

  it('binds the type values as parameters, never as SQL', async () => {
    const { target } = await make()
    const evil = "post' OR 1=1 --"
    const rel = relations(comments, ({ morphTo }) => ({
      subject: morphTo({
        type: comments.subjectType,
        id: comments.subjectId,
        targets: { [evil]: posts },
      }),
    }))
    const resolved = extractRelations({ posts, comments, rel }, target.tables)!
    const kysely = new Kysely<any>({ dialect: new SqliteDialect({ database: new Database() }) })
    const compiled = compileSqlite(
      kysely,
      'comments',
      { with: { subject: true } },
      resolved,
      target.tables,
      'many',
    )
    expect(compiled.sql).not.toContain(evil)
    expect(compiled.parameters).toContain(evil)
  })

  it('records the type column and each target in the snapshot, with no foreign key', async () => {
    const { target } = await make()
    expect(target.tables.comments!.foreignKeys).toEqual([])
    expect(target.relations!.comments!.subject).toEqual({
      kind: 'one',
      target: 'posts',
      sourceColumns: ['subjectId'],
      targetColumns: [],
      morphTo: {
        column: 'subjectType',
        targets: [
          { value: 'post', table: 'posts', key: 'id' },
          { value: 'podcast', table: 'podcasts', key: 'id' },
        ],
      },
    })
  })

  it("runs the subject table's computed fields", async () => {
    const { db } = await make()
    const dbX = db.$extends({
      result: {
        posts: { url: { needs: { id: true }, compute: (row) => `/posts/${row.id}` } },
        podcasts: { url: { needs: { id: true }, compute: (row) => `/podcasts/${row.id}` } },
      },
    })
    const rows = await dbX.query.comments.findMany({
      where: (_c, eb) => eb('id', '<=', 2),
      orderBy: (_c, eb) => eb.ref('id'),
      with: { subject: true },
    })
    expect(rows.map((c) => (c.subject as { url?: string }).url)).toEqual([
      '/posts/1',
      '/podcasts/1',
    ])
  })

  it('checks the columns, the targets and their keys', () => {
    const tokens = table('tokens', { id: text().primaryKey() })
    const pairs = table('pairs', { a: integer().notNull(), b: integer().notNull() }, (t) => ({
      pk: primaryKey().on(t.a, t.b),
    }))
    const build =
      (targets: Record<string, never>, type = comments.subjectType) =>
      () =>
        createDbClient({
          schema: {
            posts,
            pairs,
            tokens,
            comments,
            rel: relations(comments, ({ morphTo }) => ({
              subject: morphTo({ type, id: comments.subjectId, targets }),
            })),
          },
          dialect: sqliteDialect({ database: new Database(':memory:') }),
        })
    expect(build({ post: posts as never }, posts.title)).toThrow(
      /morphTo `comments.subject`: 'title' is not a column of 'comments'/,
    )
    expect(build({ pair: pairs as never })).toThrow(/'pairs' has a composite primary key/)
    expect(build({ '': posts as never })).toThrow(/a type value in `targets` is an empty string/)
    expect(build({})).toThrow(/`targets` is empty/)
    // MySQL's int unsigned is an integer too.
    const counters = table('counters', { id: unsigned(integer()).primaryKey() })
    expect(() =>
      createDbClient({
        schema: {
          counters,
          comments,
          rel: relations(comments, ({ morphTo }) => ({
            subject: morphTo({
              type: comments.subjectType,
              id: comments.subjectId,
              targets: { c: counters },
            }),
          })),
        },
        dialect: sqliteDialect({ database: new Database(':memory:') }),
      }),
    ).not.toThrow()
    // A target whose key can't be compared with the id column, on any dialect.
    expect(build({ token: tokens as never })).toThrow(
      /'subjectId' is integer, but tokens.id is text — every target's key has to compare with it/,
    )
  })

  it('maps snake_case and .colName() columns', async () => {
    const blogPosts = table('blogPosts', { id: serial().primaryKey(), title: text().notNull() })
    const notes = table('notes', {
      id: serial().primaryKey(),
      subjectType: text().colName('KIND').notNull(),
      subjectId: integer().notNull(),
    })
    const rel = relations(notes, ({ morphTo }) => ({
      subject: morphTo({
        type: notes.subjectType,
        id: notes.subjectId,
        targets: { blogPost: blogPosts },
      }),
    }))
    const s = { blogPosts, notes, rel }
    const { database } = open(s, 'snake_case')
    database.exec(`
      INSERT INTO blog_posts (title) VALUES ('A');
      INSERT INTO notes (KIND, subject_id) VALUES ('blogPost', 1);
    `)
    const db = createDbClient({
      schema: s,
      dialect: sqliteDialect({ database }),
      casing: 'snake_case',
    })
    const rows = await db.query.notes.findMany({ with: { subject: true } })
    expect(rows[0]!.subject).toEqual({ id: 1, title: 'A' })
  })

  it("keeps 'column' tenancy on the subject", async () => {
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
    })
    const rel = relations(notes, ({ morphTo }) => ({
      subject: morphTo({
        type: notes.subjectType,
        id: notes.subjectId,
        targets: { article: articles },
      }),
    }))
    const s = { articles, notes, rel }
    const { database } = open(s)
    database.exec(`
      INSERT INTO articles (id, tenantId, title) VALUES (1, 'globex', 'theirs');
      INSERT INTO notes (tenantId, subjectType, subjectId) VALUES ('acme', 'article', 1);
    `)
    const db = createDbClient({ schema: s, tenancy, dialect: sqliteDialect({ database }) })
    const rows = await tenancy.run('acme', () =>
      db.query.notes.findMany({ with: { subject: true } }),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.subject).toBeNull()
  })

  it('runs computeds on a subject whose type column holds numbers, and leaves a SQLite blob out of it', async () => {
    const files = table('files', {
      id: serial().primaryKey(),
      name: text().notNull(),
      body: bytea(),
    })
    const notes = table('notes', {
      id: serial().primaryKey(),
      kind: integer().notNull(),
      subjectId: integer().notNull(),
    })
    const rel = relations(notes, ({ morphTo }) => ({
      subject: morphTo({ type: notes.kind, id: notes.subjectId, targets: { 1: files } }),
    }))
    const s = { files, notes, rel }
    const { database } = open(s)
    database.exec(`
      INSERT INTO files (name, body) VALUES ('a.txt', x'0102');
      INSERT INTO notes (kind, subjectId) VALUES (1, 1);
    `)
    const db = createDbClient({ schema: s, dialect: sqliteDialect({ database }) }).$extends({
      result: { files: { upper: { needs: { name: true }, compute: (f) => f.name.toUpperCase() } } },
    })
    const rows = await db.query.notes.findMany({ with: { subject: true } })
    expect(rows[0]!.subject).toEqual({ id: 1, name: 'a.txt', upper: 'A.TXT' })
  })
})
