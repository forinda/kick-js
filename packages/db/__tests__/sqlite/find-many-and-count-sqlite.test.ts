/**
 * `db.query.X.findManyAndCount` on SQLite: one page of rows plus the total
 * `where` matches, ignoring limit / offset / orderBy and honouring softDelete.
 */
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  createDbClient,
  diff,
  emitSqlite,
  extractSnapshot,
  integer,
  relations,
  serial,
  table,
  text,
  timestamp,
} from '@forinda/kickjs-db'
import { sqliteDialect } from '@forinda/kickjs-db/sqlite'

const posts = table('posts', {
  id: serial().primaryKey(),
  status: text().notNull(),
  deletedAt: timestamp().softDelete(),
})
const comments = table('comments', {
  id: serial().primaryKey(),
  postId: integer()
    .notNull()
    .references(() => posts.id),
})
const postRelations = relations(posts, ({ many }) => ({ comments: many(comments) }))
const commentRelations = relations(comments, ({ one }) => ({
  post: one(posts, { fields: [comments.postId], references: [posts.id] }),
}))
const schema = { posts, comments, postRelations, commentRelations }

async function make() {
  const database = new Database(':memory:')
  const empty = { version: 1 as const, dialect: 'sqlite' as const, tables: {} }
  const target = extractSnapshot(schema, 'sqlite')
  database.exec(emitSqlite(diff(empty, target), { from: empty, to: target }))
  const db = createDbClient({ schema, dialect: sqliteDialect({ database }) })
  const statuses = ['draft', 'live', 'live', 'live', 'live', 'live']
  await db
    .insertInto('posts')
    .values(statuses.map((status) => ({ status })))
    .execute()
  await db
    .insertInto('comments')
    .values([{ postId: 2 }, { postId: 2 }, { postId: 3 }])
    .execute()
  // One live post is soft-deleted: 4 live posts remain visible.
  await db.updateTable('posts').set({ deletedAt: new Date() }).where('id', '=', 6).execute()
  return db
}

describe('findManyAndCount on SQLite', () => {
  it('returns one page and the total before paging', async () => {
    const db = await make()
    const { data: rows, total } = await db.query.posts.findManyAndCount({
      where: (_p, eb) => eb('status', '=', 'live'),
      orderBy: (_p, eb) => eb.ref('id'),
      limit: 2,
      offset: 1,
      with: { comments: true },
    })
    expect(total).toBe(4)
    expect(typeof total).toBe('number')
    expect(rows.map((r) => r.id)).toEqual([3, 4])
    expect(rows[0].comments).toHaveLength(1)
  })

  it('counts every row without where, and soft-deleted ones only with withDeleted', async () => {
    const db = await make()
    expect((await db.query.posts.findManyAndCount()).total).toBe(5)
    const all = await db.query.posts.findManyAndCount({ withDeleted: true, limit: 1 })
    expect(all.total).toBe(6)
    expect(all.data).toHaveLength(1)
  })

  it('returns total 0 and no rows when nothing matches', async () => {
    const db = await make()
    const { data: rows, total } = await db.query.posts.findManyAndCount({
      where: (_p, eb) => eb('status', '=', 'archived'),
    })
    expect({ rows, total }).toEqual({ rows: [], total: 0 })
  })
})
