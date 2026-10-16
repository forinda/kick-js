/** Polymorphic one-to-many (`morphMany`, `morphOne`) on MySQL. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql'
import { createPool, type Pool } from 'mysql2/promise'
import {
  createDbClient,
  desc,
  diff,
  emitMysql,
  extractSnapshot,
  index,
  integer,
  relations,
  serial,
  table,
  text,
  varchar,
} from '@forinda/kickjs-db'
import { mysqlDialect } from '@forinda/kickjs-db/mysql'

const posts = table('posts', { id: serial().primaryKey(), title: text().notNull() })
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
const postRelations = relations(posts, ({ morphMany, morphOne }) => ({
  comments: morphMany(comments, { type: comments.subjectType, id: comments.subjectId, as: 'post' }),
  latestComment: morphOne(comments, {
    type: comments.subjectType,
    id: comments.subjectId,
    as: 'post',
  }),
}))
const podcastRelations = relations(podcasts, ({ morphMany }) => ({
  // A quote in the value: it's bound, so it can't break out of the SQL.
  comments: morphMany(comments, {
    type: comments.subjectType,
    id: comments.subjectId,
    as: "pod'cast",
  }),
}))
const schema = { posts, podcasts, comments, postRelations, podcastRelations }

let container: StartedMySqlContainer
let pool: Pool

beforeAll(async () => {
  container = await new MySqlContainer('mysql:8.0').start()
  pool = createPool({
    host: container.getHost(),
    port: container.getPort(),
    user: 'root',
    password: container.getRootPassword(),
    database: container.getDatabase(),
    multipleStatements: true,
  })
  const empty = { version: 1 as const, dialect: 'mysql' as const, tables: {} }
  await pool.query(emitMysql(diff(empty, extractSnapshot(schema, 'mysql'))))
  await pool.query(`
    INSERT INTO posts (title) VALUES ('Hello'), ('Quiet');
    INSERT INTO podcasts (title) VALUES ('Episode 1');
    INSERT INTO comments (subjectType, subjectId, body) VALUES
      ('post', 1, 'first!'), ('post', 1, 'nice post'), ('pod''cast', 1, 'great episode');
  `)
}, 180_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
}, 60_000)

describe('morphMany on MySQL', () => {
  it('filters by type and id, with nested options', async () => {
    const db = createDbClient({ schema, dialect: mysqlDialect({ pool }) })
    const rows = await db.query.posts.findMany({
      orderBy: (_p, eb) => eb.ref('id'),
      with: { comments: { orderBy: (_c, eb) => desc(eb.ref('id')), limit: 5 } },
    })
    expect(rows.map((p) => [p.title, p.comments.map((c) => c.body)])).toEqual([
      ['Hello', ['nice post', 'first!']],
      ['Quiet', []],
    ])
    const pods = await db.query.podcasts.findMany({ with: { comments: true } })
    expect(pods[0]!.comments.map((c) => c.body)).toEqual(['great episode'])
  }, 30_000)

  it('morphOne loads one row by type and id, or null', async () => {
    const db = createDbClient({ schema, dialect: mysqlDialect({ pool }) })
    const rows = await db.query.posts.findMany({
      orderBy: (_p, eb) => eb.ref('id'),
      with: { latestComment: { orderBy: (_c, eb) => desc(eb.ref('id')) } },
    })
    expect(rows.map((p) => [p.title, p.latestComment?.body ?? null])).toEqual([
      ['Hello', 'nice post'],
      ['Quiet', null],
    ])
  }, 30_000)
})
