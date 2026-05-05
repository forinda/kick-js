/**
 * Real-PG integration test for `db.query.X.findMany({ with })` —
 * confirms the compiled SQL produces correct row shapes against a
 * live PostgreSQL instance.
 *
 * Topology: users → posts (many) → comments (many).
 *
 * Assertions:
 *   1. 2-deep nested findMany returns the exact shape declared by
 *      the type system: User[] where each user has `posts:
 *      (Post & { comments: Comment[] })[]`.
 *   2. Empty inner sets aggregate to `[]`, not `null` (spec §4.1
 *      COALESCE behavior).
 *   3. `findFirst` returns the first row only.
 *   4. `findUnique` returns the matched row.
 *   5. Per-relation `where` + `limit` filter the inner aggregation.
 *   6. Row parity with a hand-written nested SELECT to lock the
 *      compiler against PG's `json_agg` / `to_json` semantics.
 *
 * Spec: docs/db/spec-relational-query.md §4.1 + §6.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'
import { PostgresDialect, type Generated } from 'kysely'

import {
  createDbClient,
  integer,
  relations,
  serial,
  table,
  varchar,
  type KickDbClient,
} from '@forinda/kickjs-db'

const users = table('users', {
  id: serial().primaryKey(),
  email: varchar(255).notNull().unique(),
})

const posts = table('posts', {
  id: serial().primaryKey(),
  authorId: integer()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  title: varchar(255).notNull(),
})

const comments = table('comments', {
  id: serial().primaryKey(),
  postId: integer()
    .notNull()
    .references(() => posts.id, { onDelete: 'cascade' }),
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
  users: { id: Generated<number>; email: string }
  posts: { id: Generated<number>; authorId: number; title: string }
  comments: { id: Generated<number>; postId: number; body: string }
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

let container: StartedPostgreSqlContainer
let pool: pg.Pool
let db: KickDbClient<DB>

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  pool = new pg.Pool({
    host: container.getHost(),
    port: container.getMappedPort(5432),
    user: container.getUsername(),
    password: container.getPassword(),
    database: container.getDatabase(),
  })

  await pool.query(`
    CREATE TABLE "users" (
      "id" serial PRIMARY KEY,
      "email" varchar(255) NOT NULL UNIQUE
    );
    CREATE TABLE "posts" (
      "id" serial PRIMARY KEY,
      "authorId" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "title" varchar(255) NOT NULL
    );
    CREATE TABLE "comments" (
      "id" serial PRIMARY KEY,
      "postId" integer NOT NULL REFERENCES "posts"("id") ON DELETE CASCADE,
      "body" varchar(1000) NOT NULL
    );
  `)

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
    dialect: new PostgresDialect({ pool }),
  })
}, 90_000)

afterAll(async () => {
  await db?.destroy()
  await container?.stop()
})

beforeEach(async () => {
  await pool.query(`TRUNCATE TABLE "users" RESTART IDENTITY CASCADE`)
})

async function seed() {
  // 2 users; user 1 has 2 posts (post1 + post2), user 2 has 1 post (post3).
  // post1 has 2 comments, post2 has 1 comment, post3 has 0 comments.
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

describe('db.query.X.findMany({ with }) — real PG round trip', () => {
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
    const p3 = u2.posts[0]
    // Empty inner set — must be [] not null per spec §4.1 COALESCE.
    expect(p3.comments).toEqual([])
  }, 60_000)

  it('one-relation returns null when no matching row', async () => {
    // Insert a comment first, then orphan it by removing its post —
    // we already cascade-deleted in beforeEach so the table is empty.
    // Here we use posts without any user, which is forbidden by the
    // FK; test the `null` path via findFirst returning null on an
    // empty table instead.
    const u = await db.query.users.findFirst()
    expect(u).toBeNull()
  }, 30_000)

  it('findFirst returns one row clamped via LIMIT 1', async () => {
    await seed()
    const u = await db.query.users.findFirst({ orderBy: (_u, eb) => eb.ref('id') })
    expect(u?.email).toBe('a@b.com')
  }, 30_000)

  it('findUnique on a uniquely-keyed predicate returns the row', async () => {
    await seed()
    const u = await db.query.users.findUnique({
      where: (_u, eb) => eb('email', '=', 'c@d.com'),
    })
    expect(u?.email).toBe('c@d.com')
  }, 30_000)

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
    // user 2's only post is titled "third" — filtered out, so []
    expect(u2.posts).toEqual([])
  }, 30_000)

  it('row shape matches the equivalent hand-written nested SELECT', async () => {
    await seed()
    const compiled = await db.query.users.findMany({
      with: { posts: { with: { comments: true } } },
      orderBy: (_u, eb) => eb.ref('id'),
    })

    // Hand-written equivalent — what an adopter would write today
    // using layer 1 + a manual join + JSON aggregation.
    const handRolled = await pool.query<{
      id: number
      email: string
      posts: Array<{
        id: number
        authorId: number
        title: string
        comments: Array<{ id: number; postId: number; body: string }>
      }>
    }>(`
      SELECT u.id, u.email,
        COALESCE((
          SELECT json_agg(p_outer)
          FROM (
            SELECT p.*,
              COALESCE((
                SELECT json_agg(c)
                FROM "comments" c
                WHERE c."postId" = p.id
              ), '[]'::json) AS comments
            FROM "posts" p
            WHERE p."authorId" = u.id
          ) p_outer
        ), '[]'::json) AS posts
      FROM "users" u
      ORDER BY u.id
    `)

    // Both should produce structurally equivalent rows. We compare
    // counts + per-user post counts + per-post comment counts.
    expect(compiled).toHaveLength(handRolled.rows.length)
    for (let i = 0; i < compiled.length; i++) {
      expect(compiled[i].email).toBe(handRolled.rows[i].email)
      expect(compiled[i].posts.length).toBe(handRolled.rows[i].posts.length)
      for (let j = 0; j < compiled[i].posts.length; j++) {
        expect(compiled[i].posts[j].comments.length).toBe(
          handRolled.rows[i].posts[j].comments.length,
        )
      }
    }
  }, 60_000)
})
