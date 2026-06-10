/**
 * Real-driver integration test for the SQLite relational-query
 * compiler — exercises the full path from `db.query.X.findMany({ with })`
 * through `compileSqlite` -> kysely/helpers/sqlite's
 * `jsonArrayFrom`/`jsonObjectFrom` -> `ParseJSONResultsPlugin` ->
 * better-sqlite3 -> JS row tree.
 *
 * Spec: docs/db/spec-relational-query-other-dialects.md §3.1.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'

import {
  createDbClient,
  integer,
  relations,
  serial,
  table,
  varchar,
  type KickDbClient,
} from '@forinda/kickjs-db'
import { sqliteAdapter, sqliteDialect } from '../../src'

const users = table('users', {
  id: serial().primaryKey(),
  email: varchar(255).notNull().unique(),
})

const posts = table('posts', {
  id: serial().primaryKey(),
  authorId: integer()
    .notNull()
    .references(() => users.id),
  title: varchar(255).notNull(),
})

const comments = table('comments', {
  id: serial().primaryKey(),
  postId: integer()
    .notNull()
    .references(() => posts.id),
  body: varchar(1000).notNull(),
})

const usersRelations = relations(users, (h) => ({ posts: h.many(posts) }))
const postsRelations = relations(posts, (h) => ({
  author: h.one(users, { fields: [posts.authorId], references: [users.id] }),
  comments: h.many(comments),
}))
const commentsRelations = relations(comments, (h) => ({
  post: h.one(posts, { fields: [comments.postId], references: [posts.id] }),
}))

interface DB {
  users: { id: number; email: string }
  posts: { id: number; authorId: number; title: string }
  comments: { id: number; postId: number; body: string }
}

declare module '@forinda/kickjs-db' {
  interface KickDbRelationsRegister {
    db: {
      users: { posts: { kind: 'many'; target: 'posts' } }
      posts: {
        author: { kind: 'one'; target: 'users' }
        comments: { kind: 'many'; target: 'comments' }
      }
      comments: { post: { kind: 'one'; target: 'posts' } }
    }
  }
}

let database: Database.Database
let db: KickDbClient<DB>

const seedSchemaSql = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE
  );
  CREATE TABLE posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    authorId INTEGER NOT NULL REFERENCES users(id),
    title TEXT NOT NULL
  );
  CREATE TABLE comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    postId INTEGER NOT NULL REFERENCES posts(id),
    body TEXT NOT NULL
  );
`

beforeAll(() => {
  database = new Database(':memory:')
  database.exec(seedSchemaSql)

  const schema = {
    users,
    posts,
    comments,
    usersRelations,
    postsRelations,
    commentsRelations,
  }
  db = createDbClient<typeof schema, DB>({
    schema,
    dialect: sqliteDialect({ database }),
  })
})

afterAll(async () => {
  await db?.destroy()
  database?.close()
})

beforeEach(() => {
  // Reset rows + sqlite_sequence so AUTOINCREMENT IDs restart at 1
  // each test. Without the sequence reset, post-DELETE inserts would
  // get IDs 3+ on a clean run, breaking the hard-coded authorId
  // references in seed().
  database.exec(`
    DELETE FROM comments;
    DELETE FROM posts;
    DELETE FROM users;
    DELETE FROM sqlite_sequence WHERE name IN ('users', 'posts', 'comments');
  `)
})

async function seed() {
  await db
    .insertInto('users')
    .values([{ email: 'a@b.com' }, { email: 'c@d.com' }])
    .execute()
  await db
    .insertInto('posts')
    .values([
      { authorId: 1, title: 'first' },
      { authorId: 1, title: 'second' },
      { authorId: 2, title: 'third' },
    ])
    .execute()
  await db
    .insertInto('comments')
    .values([
      { postId: 1, body: 'c1' },
      { postId: 1, body: 'c2' },
      { postId: 2, body: 'c3' },
    ])
    .execute()
}

describe('db.query.X.findMany({ with }) — real better-sqlite3 round trip', () => {
  it('2-deep nested findMany returns the declared shape', async () => {
    await seed()
    const rows = await db.query.users.findMany({
      with: { posts: { with: { comments: true } } },
      orderBy: (_u, eb) => eb.ref('id'),
    })
    expect(rows).toHaveLength(2)

    const u1 = rows.find((r) => r.email === 'a@b.com')!
    expect(u1.posts).toHaveLength(2)
    const p1 = u1.posts.find((p) => p.title === 'first')!
    expect(p1.comments.map((c) => c.body).toSorted()).toEqual(['c1', 'c2'])
    const p2 = u1.posts.find((p) => p.title === 'second')!
    expect(p2.comments.map((c) => c.body)).toEqual(['c3'])

    const u2 = rows.find((r) => r.email === 'c@d.com')!
    expect(u2.posts).toHaveLength(1)
    // Empty inner set — must be [] not null, matching PG behavior.
    expect(u2.posts[0].comments).toEqual([])
  })

  it('findFirst returns null on empty table', async () => {
    const u = await db.query.users.findFirst()
    expect(u).toBeNull()
  })

  it('findFirst clamps to one row', async () => {
    await seed()
    const u = await db.query.users.findFirst({ orderBy: (_u, eb) => eb.ref('id') })
    expect(u?.email).toBe('a@b.com')
  })

  it('findUnique returns the matched row', async () => {
    await seed()
    const u = await db.query.users.findUnique({
      where: (_u, eb) => eb('email', '=', 'c@d.com'),
    })
    expect(u?.email).toBe('c@d.com')
  })

  it('per-relation where + limit filters the inner aggregation', async () => {
    await seed()
    const rows = await db.query.users.findMany({
      with: {
        posts: {
          where: (_p, eb) => eb('title', '=', 'first'),
          limit: 1,
        },
      },
      orderBy: (_u, eb) => eb.ref('id'),
    })
    const u1 = rows.find((r) => r.email === 'a@b.com')!
    expect(u1.posts.map((p) => p.title)).toEqual(['first'])
    const u2 = rows.find((r) => r.email === 'c@d.com')!
    expect(u2.posts).toEqual([])
  })

  it('ParseJSONResultsPlugin auto-attached — nested rows arrive as JS objects, not strings', async () => {
    await seed()
    const rows = await db.query.users.findMany({
      with: { posts: true },
      orderBy: (_u, eb) => eb.ref('id'),
    })
    // posts is a real array of objects, not a JSON string. Without
    // ParseJSONResultsPlugin, this would be `typeof posts === 'string'`.
    expect(Array.isArray(rows[0].posts)).toBe(true)
    expect(typeof rows[0].posts).toBe('object')
    expect(typeof rows[0].posts[0]).toBe('object')
  })
})

describe('sqliteAdapter — migration table contract', () => {
  it('ensureMigrationTables creates idempotent tables', async () => {
    const adapter = sqliteAdapter({ database })
    await adapter.ensureMigrationTables()
    await adapter.ensureMigrationTables() // second call must not error
    const tables = database
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'kick_migrations%' ORDER BY name`,
      )
      .all<{ name: string }>()
    expect(tables.map((t) => t.name)).toEqual(['kick_migrations', 'kick_migrations_lock'])
  })

  it('listApplied / recordApplied / removeApplied round-trip', async () => {
    const adapter = sqliteAdapter({ database })
    await adapter.ensureMigrationTables()
    expect(await adapter.listApplied()).toEqual([])

    await adapter.recordApplied({
      id: '20260505_010000_a',
      name: 'a',
      hash: 'sha256:abc',
      batch: 1,
      direction: 'up',
    })
    const applied = await adapter.listApplied()
    expect(applied).toHaveLength(1)
    expect(applied[0]).toMatchObject({
      id: '20260505_010000_a',
      name: 'a',
      hash: 'sha256:abc',
      batch: 1,
      direction: 'up',
    })

    await adapter.removeApplied('20260505_010000_a')
    expect(await adapter.listApplied()).toEqual([])
  })

  it('acquireLock / releaseLock — only one acquirer wins', async () => {
    const adapter = sqliteAdapter({ database })
    await adapter.ensureMigrationTables()
    expect(await adapter.acquireLock('proc-1')).toBe(true)
    expect(await adapter.acquireLock('proc-2')).toBe(false)
    await adapter.releaseLock()
    expect(await adapter.acquireLock('proc-3')).toBe(true)
    await adapter.releaseLock()
  })

  it('introspect reads the live schema via sqlite_master + PRAGMA', async () => {
    const adapter = sqliteAdapter({ database })
    const snap = await adapter.introspect()
    expect(snap.dialect).toBe('sqlite')
    // The suite created tables on this handle — introspect sees them.
    expect(Object.keys(snap.tables).length).toBeGreaterThan(0)
  })
})
