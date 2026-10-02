/**
 * MySQL end to end, the way an app wires it: one `mysql2/promise` pool for
 * both `mysqlDialect` and `mysqlAdapter` (no casts), migrations with a
 * foreign key applied twice, typed queries, and relational reads.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { MySqlContainer, type StartedMySqlContainer } from '@testcontainers/mysql'
import { createPool, type Pool } from 'mysql2/promise'

import {
  appendJournalEntry,
  computeMigrationHash,
  createDbClient,
  date,
  diff,
  emitMysql,
  extractSnapshot,
  integer,
  migrateLatest,
  relations,
  serial,
  table,
  timestamp,
  varchar,
  type SchemaSnapshot,
} from '@forinda/kickjs-db'
import { mysqlAdapter, mysqlDialect } from '@forinda/kickjs-db/mysql'

const users = table('users', {
  id: serial().primaryKey(),
  email: varchar(255).notNull().unique(),
  createdAt: timestamp().notNull().defaultNow(),
})
const posts = table('posts', {
  id: serial().primaryKey(),
  // No index of its own: InnoDB adds one for the foreign key.
  authorId: integer()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  title: varchar(200).notNull(),
  publishedAt: timestamp().notNull(),
  day: date(),
})
const usersRelations = relations(users, ({ many }) => ({ posts: many(posts) }))
const postsRelations = relations(posts, ({ one }) => ({
  author: one(users, { fields: [posts.authorId], references: [users.id] }),
}))
const schema = { users, posts, usersRelations, postsRelations }

const empty: SchemaSnapshot = { version: 1, dialect: 'mysql', tables: {} }

/** Write a reviewed migration taking the schema from `from` to `to`. */
async function writeMigration(dir: string, id: string, from: SchemaSnapshot, to: SchemaSnapshot) {
  const out = path.join(dir, id)
  await mkdir(out, { recursive: true })
  await writeFile(path.join(out, 'up.sql'), emitMysql(diff(from, to)))
  await writeFile(path.join(out, 'down.sql'), '')
  await writeFile(path.join(out, 'snapshot.json'), JSON.stringify(to))
  await writeFile(
    path.join(out, 'meta.json'),
    JSON.stringify({
      id,
      name: id,
      reviewed: true,
      dialect: 'mysql',
      previousId: null,
      downIsDraft: false,
    }),
  )
  await appendJournalEntry(dir, 'mysql', {
    id,
    tag: id,
    hash: await computeMigrationHash(out),
    createdAt: new Date().toISOString(),
  })
}

let container: StartedMySqlContainer
let pool: Pool
let migrationsDir: string

beforeAll(async () => {
  container = await new MySqlContainer('mysql:8.0').start()
  pool = createPool({
    host: container.getHost(),
    port: container.getPort(),
    user: 'root',
    password: container.getRootPassword(),
    database: container.getDatabase(),
    timezone: 'Z',
  })
  migrationsDir = await mkdtemp(path.join(tmpdir(), 'kickdb-mysql-'))
}, 180_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
  await rm(migrationsDir, { recursive: true, force: true })
})

describe('MySQL, end to end', () => {
  it('applies migrations with a foreign key, twice, without false drift', async () => {
    const adapter = mysqlAdapter({ pool })
    const first = extractSnapshot(schema, 'mysql')
    await writeMigration(migrationsDir, '20260101_000000_init', empty, first)
    await migrateLatest({ adapter, migrationsDir })

    const withViews = extractSnapshot(
      {
        ...schema,
        posts: table('posts', { ...posts.__columns, views: integer().notNull().default(0) }),
      },
      'mysql',
    )
    await writeMigration(migrationsDir, '20260102_000000_views', first, withViews)
    await expect(migrateLatest({ adapter, migrationsDir })).resolves.toMatchObject({
      applied: ['20260102_000000_views'],
    })
  }, 120_000)

  it('queries through a mysql2/promise pool, and nests dates as Dates', async () => {
    const db = createDbClient({ schema, dialect: mysqlDialect({ pool }) })
    const publishedAt = new Date('2026-03-04T05:06:07.000Z')

    await db.insertInto('users').values({ email: 'ada@example.com' }).execute()
    const user = await db
      .selectFrom('users')
      .selectAll()
      .where('email', '=', 'ada@example.com')
      .executeTakeFirstOrThrow()
    expect(user.createdAt).toBeInstanceOf(Date)

    await db
      .insertInto('posts')
      .values({
        authorId: user.id,
        title: 'Hello',
        publishedAt,
        day: new Date('2026-03-04T00:00:00Z'),
      })
      .execute()

    const top = await db.selectFrom('posts').selectAll().executeTakeFirstOrThrow()
    const nested = await db.query.users.findFirst({ with: { posts: true } })
    const post = nested!.posts[0]!
    expect(post.publishedAt).toBeInstanceOf(Date)
    expect(post.publishedAt).toEqual(top.publishedAt)
    expect(post.publishedAt).toEqual(publishedAt)
    expect(post.day).toEqual(top.day)
  }, 60_000)

  it('with dateStrings, nested dates stay strings like top-level ones', async () => {
    const strings = createPool({
      host: container.getHost(),
      port: container.getPort(),
      user: 'root',
      password: container.getRootPassword(),
      database: container.getDatabase(),
      timezone: 'Z',
      dateStrings: true,
    })
    const db = createDbClient({ schema, dialect: mysqlDialect({ pool: strings }) })
    const top = await db.selectFrom('posts').selectAll().executeTakeFirstOrThrow()
    const nested = (await db.query.users.findFirst({ with: { posts: true } }))!.posts[0]!
    expect(typeof top.publishedAt).toBe('string')
    expect(typeof nested.publishedAt).toBe('string')
    await strings.end()
  }, 60_000)

  it('endPoolOnClose ends a pool the adapter owns', async () => {
    const own = createPool({
      host: container.getHost(),
      port: container.getPort(),
      user: 'root',
      password: container.getRootPassword(),
      database: container.getDatabase(),
    })
    await mysqlAdapter({ pool: own, endPoolOnClose: true }).close()
    await expect(own.query('SELECT 1')).rejects.toThrow(/closed/i)
  }, 60_000)
})
