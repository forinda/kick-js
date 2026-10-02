/** Many-to-many relational reads on Postgres. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'
import {
  createDbClient,
  diff,
  emitPg,
  extractSnapshot,
  integer,
  primaryKey,
  relations,
  serial,
  table,
  text,
} from '@forinda/kickjs-db'
import { pgDialect } from '@forinda/kickjs-db/pg'

const posts = table('posts', { id: serial().primaryKey(), title: text().notNull() })
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
const postRelations = relations(posts, ({ many }) => ({ tags: many(tags, { through: postTags }) }))
const tagRelations = relations(tags, ({ many }) => ({ posts: many(posts, { through: postTags }) }))
const schema = { posts, tags, postTags, postRelations, tagRelations }

let container: StartedPostgreSqlContainer
let pool: pg.Pool

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  pool = new pg.Pool({ connectionString: container.getConnectionUri() })
  pool.on('error', () => {})
  const empty = { version: 1 as const, dialect: 'postgres' as const, tables: {} }
  await pool.query(emitPg(diff(empty, extractSnapshot(schema, 'postgres'))))
  await pool.query(`
    INSERT INTO posts (title) VALUES ('First'), ('Second');
    INSERT INTO tags (name) VALUES ('db'), ('sql');
    INSERT INTO post_tags ("postId", "tagId") VALUES (1, 1), (1, 2), (2, 2);
  `)
}, 120_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
}, 60_000)

describe('many-to-many on Postgres', () => {
  it('reads through the junction, both ways, nested', async () => {
    const db = createDbClient({ schema, dialect: pgDialect({ pool }) })
    const rows = await db.query.posts.findMany({
      orderBy: (_p, eb) => eb.ref('id'),
      with: { tags: { orderBy: (_t, eb) => eb.ref('name'), with: { posts: true } } },
    })
    expect(rows.map((p) => [p.title, p.tags.map((t) => t.name)])).toEqual([
      ['First', ['db', 'sql']],
      ['Second', ['sql']],
    ])
    expect(rows[1]!.tags[0]!.posts.map((p) => p.title).toSorted()).toEqual(['First', 'Second'])
  }, 30_000)
})
