/** Polymorphic one-to-many (`morphMany`) on Postgres. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'
import {
  createDbClient,
  desc,
  diff,
  emitPg,
  extractSnapshot,
  index,
  integer,
  relations,
  serial,
  table,
  text,
} from '@forinda/kickjs-db'
import { pgDialect } from '@forinda/kickjs-db/pg'

const posts = table('posts', { id: serial().primaryKey(), title: text().notNull() })
const podcasts = table('podcasts', { id: serial().primaryKey(), title: text().notNull() })
const comments = table(
  'comments',
  {
    id: serial().primaryKey(),
    subjectType: text().notNull(),
    subjectId: integer().notNull(),
    body: text().notNull(),
  },
  (t) => ({ subject: index('comments_subject_idx').on(t.subjectType, t.subjectId) }),
)
const postRelations = relations(posts, ({ morphMany }) => ({
  comments: morphMany(comments, { type: comments.subjectType, id: comments.subjectId, as: 'post' }),
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

let container: StartedPostgreSqlContainer
let pool: pg.Pool

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  pool = new pg.Pool({ connectionString: container.getConnectionUri() })
  pool.on('error', () => {})
  const empty = { version: 1 as const, dialect: 'postgres' as const, tables: {} }
  await pool.query(emitPg(diff(empty, extractSnapshot(schema, 'postgres'))))
  await pool.query(`
    INSERT INTO posts (title) VALUES ('Hello'), ('Quiet');
    INSERT INTO podcasts (title) VALUES ('Episode 1');
    INSERT INTO comments ("subjectType", "subjectId", body) VALUES
      ('post', 1, 'first!'), ('post', 1, 'nice post'), ('pod''cast', 1, 'great episode');
  `)
}, 120_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
}, 60_000)

describe('morphMany on Postgres', () => {
  it('filters by type and id, with nested options', async () => {
    const db = createDbClient({ schema, dialect: pgDialect({ pool }) })
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
})
