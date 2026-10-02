/** D.21 on MySQL 8: snake_case columns, camelCase keys, nested relational reads included. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql'
import { createPool, type Pool } from 'mysql2/promise'
import {
  checkDrift,
  createDbClient,
  diff,
  emitMysql,
  extractSnapshot,
  integer,
  introspectMysql,
  relations,
  serial,
  table,
  text,
  timestamp,
} from '@forinda/kickjs-db'
import { mysqlDialect } from '@forinda/kickjs-db/mysql'

const users = table('users', {
  id: serial().primaryKey(),
  firstName: text().notNull(),
  createdAt: timestamp().notNull().defaultNow(),
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
}, 180_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
}, 60_000)

describe('casing on MySQL', () => {
  it('maps keys to snake_case columns, at every level of db.query', async () => {
    const target = extractSnapshot(schema, 'mysql', { casing: 'snake_case' })
    await pool.query(emitMysql(diff({ version: 1, dialect: 'mysql', tables: {} }, target)))
    const db = createDbClient({ schema, dialect: mysqlDialect({ pool }), casing: 'snake_case' })

    await db.insertInto('users').values({ firstName: 'Ada' }).execute()
    await db.insertInto('blogPosts').values({ authorId: 1, postTitle: 'Engines' }).execute()
    const [rows] = await pool.query('SELECT first_name FROM users')
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
    await expect(checkDrift(await introspectMysql(pool), target, 'error')).resolves.toBeUndefined()
  }, 60_000)
})
