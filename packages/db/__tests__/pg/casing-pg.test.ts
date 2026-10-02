/** D.21 on Postgres: snake_case columns, camelCase keys, nested relational reads included. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'
import {
  checkDrift,
  createDbClient,
  diff,
  emitPg,
  extractSnapshot,
  integer,
  introspectPg,
  relations,
  serial,
  table,
  text,
  timestamptz,
} from '@forinda/kickjs-db'
import { pgDialect } from '@forinda/kickjs-db/pg'

const users = table('users', {
  id: serial().primaryKey(),
  firstName: text().notNull(),
  createdAt: timestamptz().notNull().defaultNow(),
})
const blogPosts = table('blogPosts', {
  id: serial().primaryKey(),
  authorId: integer()
    .notNull()
    .references(() => users.id),
  postTitle: text().notNull(),
})
const userRelations = relations(users, ({ many }) => ({ blogPosts: many(blogPosts) }))
const postRelations = relations(blogPosts, ({ one }) => ({
  author: one(users, { fields: [blogPosts.authorId], references: [users.id] }),
}))
const schema = { users, blogPosts, userRelations, postRelations }

let container: StartedPostgreSqlContainer
let pool: pg.Pool

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  pool = new pg.Pool({ connectionString: container.getConnectionUri() })
  pool.on('error', () => {})
}, 120_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
}, 60_000)

describe('casing on Postgres', () => {
  it('maps keys to snake_case columns, at every level of db.query', async () => {
    const target = extractSnapshot(schema, 'postgres', { casing: 'snake_case' })
    await pool.query(emitPg(diff({ version: 1, dialect: 'postgres', tables: {} }, target)))
    const db = createDbClient({ schema, dialect: pgDialect({ pool }), casing: 'snake_case' })

    await db.insertInto('users').values({ firstName: 'Ada' }).execute()
    await db.insertInto('blogPosts').values({ authorId: 1, postTitle: 'Engines' }).execute()
    const { rows } = await pool.query('SELECT first_name FROM users')
    expect(rows).toEqual([{ first_name: 'Ada' }])

    const posts = await db.query.blogPosts.findMany({
      with: { author: { with: { blogPosts: true } } },
    })
    expect(posts[0]).toMatchObject({
      postTitle: 'Engines',
      authorId: 1,
      author: { firstName: 'Ada', blogPosts: [{ postTitle: 'Engines' }] },
    })
    expect(posts[0].author!.createdAt).toBeInstanceOf(Date)
    await expect(checkDrift(await introspectPg(pool), target, 'error')).resolves.toBeUndefined()
  }, 60_000)
})
