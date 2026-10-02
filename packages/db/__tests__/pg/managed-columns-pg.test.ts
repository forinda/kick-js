/**
 * Managed columns (D.10) on Postgres — plain updates, an upsert's update
 * branch, and soft delete in relational reads.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'
import {
  createDbClient,
  diff,
  emitPg,
  extractSnapshot,
  integer,
  relations,
  serial,
  table,
  text,
  timestamptz,
  version,
} from '@forinda/kickjs-db'
import { pgDialect } from '@forinda/kickjs-db/pg'

const docs = table('docs', {
  id: serial().primaryKey(),
  slug: text().notNull().unique(),
  title: text().notNull(),
  version: version(),
  updatedAt: timestamptz().notNull().defaultNow().onUpdateNow(),
  deletedAt: timestamptz().softDelete(),
})
const comments = table('comments', {
  id: serial().primaryKey(),
  docId: integer()
    .notNull()
    .references(() => docs.id),
  body: text().notNull(),
  deletedAt: timestamptz().softDelete(),
})
const docRelations = relations(docs, ({ many }) => ({ comments: many(comments) }))
const commentRelations = relations(comments, ({ one }) => ({
  doc: one(docs, { fields: [comments.docId], references: [docs.id] }),
}))
const schema = { docs, comments, docRelations, commentRelations }

let container: StartedPostgreSqlContainer
let pool: pg.Pool

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  pool = new pg.Pool({ connectionString: container.getConnectionUri() })
  pool.on('error', () => {})
  const empty = { version: 1 as const, dialect: 'postgres' as const, tables: {} }
  await pool.query(emitPg(diff(empty, extractSnapshot(schema, 'postgres'))))
}, 120_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
}, 60_000)

describe('managed columns on Postgres', () => {
  it('maintains updatedAt and version, in updates and upserts', async () => {
    const db = createDbClient({ schema, dialect: pgDialect({ pool }) })
    const first = await db.upsert('docs', { values: { slug: 'a', title: 'A' }, target: ['slug'] })
    expect(first.version).toBe(0)

    await new Promise((r) => setTimeout(r, 5))
    await db.updateTable('docs').set({ title: 'A2' }).where('id', '=', first.id).execute()
    const second = await db.upsert('docs', { values: { slug: 'a', title: 'A3' }, target: ['slug'] })
    expect(second.version).toBe(2)
    expect(second.updatedAt.getTime()).toBeGreaterThan(first.updatedAt.getTime())
  }, 30_000)

  it('db.query skips soft-deleted rows at every level, unless withDeleted', async () => {
    const db = createDbClient({ schema, dialect: pgDialect({ pool }) })
    const live = await db.upsert('docs', {
      values: { slug: 'live', title: 'Live' },
      target: ['slug'],
    })
    await db
      .insertInto('docs')
      .values({ slug: 'gone', title: 'Gone', deletedAt: new Date() })
      .execute()
    await db.insertInto('comments').values({ docId: live.id, body: 'kept' }).execute()
    await db
      .insertInto('comments')
      .values({ docId: live.id, body: 'hidden', deletedAt: new Date() })
      .execute()

    const doc = await db.query.docs.findFirst({
      where: (_d, eb) => eb('slug', '=', 'live'),
      with: { comments: true },
    })
    expect(doc!.comments.map((c) => c.body)).toEqual(['kept'])
    expect(await db.query.docs.findFirst({ where: (_d, eb) => eb('slug', '=', 'gone') })).toBeNull()
    expect(
      await db.query.docs.findFirst({
        where: (_d, eb) => eb('slug', '=', 'gone'),
        withDeleted: true,
      }),
    ).toMatchObject({ slug: 'gone' })
  }, 30_000)
})
