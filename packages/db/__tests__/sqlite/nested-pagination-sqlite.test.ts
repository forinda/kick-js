/**
 * Paging a large to-many relation: a first page with the parent (per-parent
 * limit, a count in `extras`), then later pages straight from the child table.
 */
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  createDbClient,
  desc,
  diff,
  emitSqlite,
  extractSnapshot,
  index,
  integer,
  relations,
  serial,
  sql,
  table,
  text,
} from '@forinda/kickjs-db'
import { sqliteDialect } from '@forinda/kickjs-db/sqlite'

const posts = table('posts', { id: serial().primaryKey(), title: text().notNull() })
const comments = table(
  'comments',
  {
    id: serial().primaryKey(),
    postId: integer()
      .notNull()
      .references(() => posts.id),
    body: text().notNull(),
  },
  (t) => ({ byPost: index('comments_post_id_idx').on(t.postId, t.id) }),
)
const postRelations = relations(posts, ({ many }) => ({ comments: many(comments) }))
const commentRelations = relations(comments, ({ one }) => ({
  post: one(posts, { fields: [comments.postId], references: [posts.id] }),
}))
const schema = { posts, comments, postRelations, commentRelations }

async function seeded() {
  const database = new Database(':memory:')
  const empty = { version: 1 as const, dialect: 'sqlite' as const, tables: {} }
  const target = extractSnapshot(schema, 'sqlite')
  database.exec(emitSqlite(diff(empty, target), { from: empty, to: target }))
  const db = createDbClient({ schema, dialect: sqliteDialect({ database }) })
  await db
    .insertInto('posts')
    .values([{ title: 'Busy' }, { title: 'Quiet' }])
    .execute()
  // 50 comments on the busy post (ids 1–50), 3 on the quiet one (51–53).
  await db
    .insertInto('comments')
    .values([
      ...Array.from({ length: 50 }, (_, i) => ({ postId: 1, body: `c${i + 1}` })),
      ...Array.from({ length: 3 }, (_, i) => ({ postId: 2, body: `q${i + 1}` })),
    ])
    .execute()
  return db
}

const ids = (rows: { id: number }[]) => rows.map((r) => r.id)

describe('paging nested rows', () => {
  it('limits per parent, with the total from extras', async () => {
    const db = await seeded()
    const rows = await db.query.posts.findMany({
      orderBy: (_p, eb) => eb.ref('id'),
      extras: {
        commentCount: (_p, eb) =>
          eb
            .selectFrom('comments')
            .select(eb.fn.countAll<number>().as('n'))
            .where('comments.postId', '=', sql.ref<number>('posts_0.id')),
      },
      with: {
        comments: { columns: { id: true }, orderBy: (_c, eb) => desc(eb.ref('id')), limit: 5 },
      },
    })
    expect(rows.map((p) => [p.title, p.commentCount, ids(p.comments)])).toEqual([
      ['Busy', 50, [50, 49, 48, 47, 46]],
      ['Quiet', 3, [53, 52, 51]],
    ])
  })

  it('takes an offset inside with', async () => {
    const db = await seeded()
    const post = await db.query.posts.findFirst({
      where: (_p, eb) => eb('id', '=', 1),
      with: {
        comments: {
          columns: { id: true },
          orderBy: (_c, eb) => desc(eb.ref('id')),
          limit: 5,
          offset: 5,
        },
      },
    })
    expect(ids(post!.comments)).toEqual([45, 44, 43, 42, 41])
  })

  it('pages the child table with findManyAndCount', async () => {
    const db = await seeded()
    const page = await db.query.comments.findManyAndCount({
      columns: { id: true },
      where: (_c, eb) => eb('postId', '=', 1),
      orderBy: (_c, eb) => desc(eb.ref('id')),
      limit: 20,
      offset: 40,
    })
    expect(page.total).toBe(50)
    expect(ids(page.data)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1])
  })

  it('pages the child table by cursor', async () => {
    const db = await seeded()
    const page = await db.query.comments.findMany({
      columns: { id: true },
      where: (_c, eb) => eb.and([eb('postId', '=', 1), eb('id', '<', 46)]),
      orderBy: (_c, eb) => desc(eb.ref('id')),
      limit: 3,
    })
    expect(ids(page)).toEqual([45, 44, 43])
  })
})
