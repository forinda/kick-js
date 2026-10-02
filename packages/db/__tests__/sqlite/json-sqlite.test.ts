/**
 * `json()`, `jsonb()` and `.array()` columns on SQLite: written as JSON
 * text, read back as the values they were — like Postgres.
 */
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  createDbClient,
  diff,
  emitSqlite,
  extractSnapshot,
  integer,
  json,
  jsonb,
  relations,
  serial,
  table,
  text,
} from '@forinda/kickjs-db'
import { sqliteDialect } from '@forinda/kickjs-db/sqlite'

const docs = table('docs', {
  id: serial().primaryKey(),
  meta: json<{ tags: string[]; draft: boolean }>().notNull(),
  extra: jsonb<Record<string, number>>(),
  scores: integer().array(),
  names: text().array(),
})
const notes = table('notes', {
  id: serial().primaryKey(),
  docId: integer()
    .notNull()
    .references(() => docs.id),
  meta: json<{ pinned: boolean }>(),
})
const docRelations = relations(docs, ({ many }) => ({ notes: many(notes) }))
const noteRelations = relations(notes, ({ one }) => ({
  doc: one(docs, { fields: [notes.docId], references: [docs.id] }),
}))
const schema = { docs, notes, docRelations, noteRelations }

function make() {
  const database = new Database(':memory:')
  const empty = { version: 1 as const, dialect: 'sqlite' as const, tables: {} }
  const target = extractSnapshot(schema, 'sqlite')
  database.exec(emitSqlite(diff(empty, target), { from: empty, to: target }))
  return createDbClient({ schema, dialect: sqliteDialect({ database }) })
}

describe('JSON and array columns on SQLite', () => {
  it('round-trip objects and arrays, top level and nested', async () => {
    const db = make()
    await db
      .insertInto('docs')
      .values({
        meta: { tags: ['a', 'b'], draft: true },
        extra: { views: 3 },
        scores: [1, 2, 3],
        names: ['x', 'y'],
      })
      .execute()
    await db
      .insertInto('notes')
      .values({ docId: 1, meta: { pinned: true } })
      .execute()
    await db
      .updateTable('docs')
      .set({ scores: [4] })
      .where('id', '=', 1)
      .execute()

    const doc = await db.selectFrom('docs').selectAll().executeTakeFirstOrThrow()
    expect(doc).toEqual({
      id: 1,
      meta: { tags: ['a', 'b'], draft: true },
      extra: { views: 3 },
      scores: [4],
      names: ['x', 'y'],
    })

    const withNotes = await db.query.docs.findFirst({ with: { notes: true } })
    expect(withNotes!.notes[0]!.meta).toEqual({ pinned: true })
  })
})
