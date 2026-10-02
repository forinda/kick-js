/** Many-to-many relational reads on MySQL. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql'
import { createPool, type Pool } from 'mysql2/promise'
import { sql } from 'kysely'
import {
  createDbClient,
  diff,
  emitMysql,
  extractSnapshot,
  integer,
  primaryKey,
  relations,
  serial,
  table,
  text,
} from '@forinda/kickjs-db'
import { mysqlDialect } from '@forinda/kickjs-db/mysql'

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
    INSERT INTO posts (title) VALUES ('First'), ('Second');
    INSERT INTO tags (name) VALUES ('db'), ('sql');
    INSERT INTO post_tags (postId, tagId) VALUES (1, 1), (1, 2), (2, 2);
  `)
}, 180_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
}, 60_000)

describe('many-to-many on MySQL', () => {
  it('reads through the junction, both ways, nested', async () => {
    const db = createDbClient({ schema, dialect: mysqlDialect({ pool }) })
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

  it('columns and extras shape relational reads', async () => {
    const db = createDbClient({ schema, dialect: mysqlDialect({ pool }) })
    const rows = await db.query.posts.findMany({
      columns: { title: true },
      extras: { loud: () => sql<string>`upper(title)` },
      orderBy: (_p, eb) => eb.ref('id'),
      with: { tags: { columns: { name: true }, orderBy: (_t, eb) => eb.ref('name') } },
    })
    expect(rows).toEqual([
      { title: 'First', loud: 'FIRST', tags: [{ name: 'db' }, { name: 'sql' }] },
      { title: 'Second', loud: 'SECOND', tags: [{ name: 'sql' }] },
    ])
  }, 30_000)

  it('findManyAndCount pages and totals', async () => {
    const db = createDbClient({ schema, dialect: mysqlDialect({ pool }) })
    const { data: rows, total } = await db.query.tags.findManyAndCount({
      orderBy: (_t, eb) => eb.ref('name'),
      limit: 1,
      with: { posts: true },
    })
    expect(total).toBe(2)
    expect(rows.map((t) => [t.name, t.posts.length])).toEqual([['db', 1]])
  }, 30_000)
})
