/**
 * Columns kick/db maintains (D.10) on SQLite: `onUpdateNow()` timestamps,
 * `version()` counters, and `softDelete()` markers honoured by db.query.
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
  version,
} from '@forinda/kickjs-db'
import { sqliteDialect } from '@forinda/kickjs-db/sqlite'

const docs = table('docs', {
  id: serial().primaryKey(),
  slug: text().notNull().unique(),
  title: text().notNull(),
  version: version(),
  createdAt: timestamp().notNull().defaultNow(),
  updatedAt: timestamp().notNull().defaultNow().onUpdateNow(),
  deletedAt: timestamp().softDelete(),
})
const comments = table('comments', {
  id: serial().primaryKey(),
  docId: integer()
    .notNull()
    .references(() => docs.id),
  body: text().notNull(),
  deletedAt: timestamp().softDelete(),
})
const docRelations = relations(docs, ({ many }) => ({ comments: many(comments) }))
const commentRelations = relations(comments, ({ one }) => ({
  doc: one(docs, { fields: [comments.docId], references: [docs.id] }),
}))
const schema = { docs, comments, docRelations, commentRelations }

function make() {
  const database = new Database(':memory:')
  const empty = { version: 1 as const, dialect: 'sqlite' as const, tables: {} }
  const target = extractSnapshot(schema, 'sqlite')
  database.exec(emitSqlite(diff(empty, target), { from: empty, to: target }))
  return createDbClient({ schema, dialect: sqliteDialect({ database }) })
}

const later = () => new Promise((r) => setTimeout(r, 5))

describe('managed columns on SQLite', () => {
  it('updatedAt moves on every update, unless the update sets it', async () => {
    const db = make()
    await db.insertInto('docs').values({ slug: 'a', title: 'A' }).execute()
    const before = await db.selectFrom('docs').selectAll().executeTakeFirstOrThrow()
    await later()

    await db.updateTable('docs').set({ title: 'A2' }).where('id', '=', 1).execute()
    const after = await db.selectFrom('docs').selectAll().executeTakeFirstOrThrow()
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime())
    expect(after.createdAt).toEqual(before.createdAt)

    const pinned = new Date('2020-01-01T00:00:00Z')
    await db
      .updateTable('docs')
      .set({ title: 'A3', updatedAt: pinned })
      .where('id', '=', 1)
      .execute()
    expect(
      (await db.selectFrom('docs').select('updatedAt').executeTakeFirstOrThrow()).updatedAt,
    ).toEqual(pinned)
  })

  it('version counts updates, and guards against a lost update', async () => {
    const db = make()
    await db.insertInto('docs').values({ slug: 'a', title: 'A' }).execute()
    const read = await db.selectFrom('docs').selectAll().executeTakeFirstOrThrow()
    expect(read.version).toBe(0)

    // Someone else saves first.
    await db.updateTable('docs').set({ title: 'theirs' }).where('id', '=', 1).execute()

    // Our save, guarded by the version we read, updates nothing.
    const { numUpdatedRows } = await db
      .updateTable('docs')
      .set({ title: 'ours' })
      .where('id', '=', 1)
      .where('version', '=', read.version)
      .executeTakeFirst()
    expect(numUpdatedRows).toBe(0n)
    expect(
      await db.selectFrom('docs').select(['title', 'version']).executeTakeFirstOrThrow(),
    ).toEqual({
      title: 'theirs',
      version: 1,
    })
  })

  it("an upsert's update branch maintains them too", async () => {
    const db = make()
    await db.upsert('docs', { values: { slug: 'a', title: 'A' }, target: ['slug'] })
    const second = await db.upsert('docs', { values: { slug: 'a', title: 'B' }, target: ['slug'] })
    expect(second.version).toBe(1)
  })

  it('db.query skips soft-deleted rows at every level, unless withDeleted', async () => {
    const db = make()
    await db.insertInto('docs').values({ slug: 'live', title: 'Live' }).execute()
    await db
      .insertInto('docs')
      .values({ slug: 'gone', title: 'Gone', deletedAt: new Date() })
      .execute()
    await db.insertInto('comments').values({ docId: 1, body: 'kept' }).execute()
    await db
      .insertInto('comments')
      .values({ docId: 1, body: 'hidden', deletedAt: new Date() })
      .execute()

    const visible = await db.query.docs.findMany({ with: { comments: true } })
    expect(visible.map((d) => d.slug)).toEqual(['live'])
    expect(visible[0]!.comments.map((c) => c.body)).toEqual(['kept'])

    const all = await db.query.docs.findMany({
      withDeleted: true,
      with: { comments: { withDeleted: true } },
      orderBy: (_d, eb) => eb.ref('id'),
    })
    expect(all.map((d) => d.slug)).toEqual(['live', 'gone'])
    expect(all[0]!.comments).toHaveLength(2)

    // The query builder is plain SQL — it sees everything.
    expect(await db.selectFrom('docs').selectAll().execute()).toHaveLength(2)
  })
})
