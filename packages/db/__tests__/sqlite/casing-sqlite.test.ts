/**
 * D.21 `casing: 'snake_case'`: camelCase keys in TypeScript, snake_case in
 * the database — in migrations, queries, relational reads and results.
 */
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  checkDrift,
  createDbClient,
  diff,
  emitSqlite,
  eq,
  extractSnapshot,
  integer,
  introspectSqlite,
  relations,
  renderSchemaSource,
  serial,
  table,
  text,
  timestamp,
  version,
} from '@forinda/kickjs-db'
import { removeCasing } from '../../src/snapshot/casing'
import { createTestDb } from '@forinda/kickjs-db/testing'
import { sqliteDialect } from '@forinda/kickjs-db/sqlite'

const users = table('users', {
  id: serial().primaryKey(),
  firstName: text().notNull(),
  emailAddress: text().notNull().unique(),
  createdAt: timestamp().notNull().defaultNow(),
  updatedAt: timestamp().notNull().defaultNow().onUpdateNow(),
  version: version(),
})
const blogPosts = table('blogPosts', {
  id: serial().primaryKey(),
  authorId: integer()
    .notNull()
    .references(() => users.id),
  postTitle: text().notNull(),
  deletedAt: timestamp().softDelete(),
})
const userRelations = relations(users, ({ many }) => ({ blogPosts: many(blogPosts) }))
const postRelations = relations(blogPosts, ({ one }) => ({
  author: one(users, { fields: [blogPosts.authorId], references: [users.id] }),
}))
const schema = { users, blogPosts, userRelations, postRelations }

function make() {
  const database = new Database(':memory:')
  const empty = { version: 1 as const, dialect: 'sqlite' as const, tables: {} }
  const target = extractSnapshot(schema, 'sqlite', { casing: 'snake_case' })
  database.exec(emitSqlite(diff(empty, target), { from: empty, to: target }))
  const db = createDbClient({ schema, dialect: sqliteDialect({ database }), casing: 'snake_case' })
  return { database, db, target }
}

describe("casing: 'snake_case'", () => {
  it('writes snake_case tables, columns and derived names', () => {
    const { database, target } = make()
    expect(Object.keys(target.tables).toSorted()).toEqual(['blog_posts', 'users'])
    const cols = database.prepare('PRAGMA table_info(users)').all() as { name: string }[]
    expect(cols.map((c) => c.name)).toEqual([
      'id',
      'first_name',
      'email_address',
      'created_at',
      'updated_at',
      'version',
    ])
    expect(target.tables.users.indexes[0].name).toBe('users_email_address_unique')
    expect(target.tables.blog_posts.foreignKeys[0]).toMatchObject({
      columns: ['author_id'],
      refTable: 'users',
      refColumns: ['id'],
    })
  })

  it('reads and writes camelCase keys, codecs and managed columns included', async () => {
    const { db } = make()
    const user = await db
      .insertInto('users')
      .values({ firstName: 'Ada', emailAddress: 'ada@x.io' })
      .returningAll()
      .executeTakeFirstOrThrow()
    expect(user).toMatchObject({ firstName: 'Ada', emailAddress: 'ada@x.io', version: 0 })
    expect(user.createdAt).toBeInstanceOf(Date)

    await db.updateTable('users').set({ firstName: 'Ada L.' }).where('id', '=', user.id).execute()
    const after = await db
      .selectFrom('users')
      .selectAll()
      .where(eq(users.emailAddress, 'ada@x.io'))
      .executeTakeFirstOrThrow()
    expect(after).toMatchObject({ firstName: 'Ada L.', version: 1 })

    const again = await db.upsert('users', {
      values: { firstName: 'Ada', emailAddress: 'ada@x.io' },
      target: ['emailAddress'],
    })
    expect(again.id).toBe(user.id)
  })

  it('db.query nests, filters soft-deleted rows and shapes fields', async () => {
    const { db } = make()
    await db.insertInto('users').values({ firstName: 'Ada', emailAddress: 'a@x.io' }).execute()
    await db
      .insertInto('blogPosts')
      .values([
        { authorId: 1, postTitle: 'Engines' },
        { authorId: 1, postTitle: 'Gone', deletedAt: new Date() },
      ])
      .execute()
    const rows = await db.query.users.findMany({
      columns: { firstName: true },
      with: { blogPosts: { columns: { postTitle: true }, with: { author: true } } },
    })
    expect(rows).toEqual([
      {
        firstName: 'Ada',
        blogPosts: [
          {
            postTitle: 'Engines',
            author: expect.objectContaining({ firstName: 'Ada', emailAddress: 'a@x.io' }),
          },
        ],
      },
    ])
    expect(rows[0].blogPosts[0].author!.createdAt).toBeInstanceOf(Date)
  })

  it('introspects without drift, and renders back to camelCase keys', async () => {
    const { database, target } = make()
    const live = introspectSqlite(database)
    await expect(checkDrift(live, target, 'error')).resolves.toBeUndefined()
    const src = renderSchemaSource(removeCasing(live))
    expect(src).toContain("table('blogPosts'")
    expect(src).toContain('postTitle: text().notNull()')
    expect(src).toContain('emailAddress: text().notNull()')
  })

  it('createTestDb takes the same casing', async () => {
    const db = await createTestDb({ schema, casing: 'snake_case' })
    await db.insertInto('users').values({ firstName: 'Ada', emailAddress: 'x@x.io' }).execute()
    expect((await db.selectFrom('users').select('firstName').execute())[0]).toEqual({
      firstName: 'Ada',
    })
  })
})
