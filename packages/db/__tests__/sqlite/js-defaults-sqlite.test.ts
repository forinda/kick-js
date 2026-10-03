/**
 * D.24: defaults and update values computed in JS — `$defaultFn` on insert,
 * `$onUpdate` on update and an upsert's update branch.
 */
import { describe, expect, expectTypeOf, it } from 'vitest'
import Database from 'better-sqlite3'
import { createDbClient, diff, emitSqlite, extractSnapshot, table, text } from '@forinda/kickjs-db'
import { sqliteDialect } from '@forinda/kickjs-db/sqlite'

let seq = 0
let editor = 'ada'
const notes = table('notes', {
  id: text()
    .primaryKey()
    .$defaultFn(() => `n${++seq}`),
  body: text().notNull(),
  editedBy: text().$onUpdate(() => editor),
})
const schema = { notes }

function make() {
  seq = 0
  editor = 'ada'
  const database = new Database(':memory:')
  const empty = { version: 1 as const, dialect: 'sqlite' as const, tables: {} }
  const target = extractSnapshot(schema, 'sqlite')
  database.exec(emitSqlite(diff(empty, target), { from: empty, to: target }))
  return createDbClient({ schema, dialect: sqliteDialect({ database }) })
}

describe('$defaultFn and $onUpdate', () => {
  it('fills $defaultFn per inserted row, and keeps a value that is given', async () => {
    const db = make()
    await db
      .insertInto('notes')
      .values([{ body: 'a' }, { body: 'b' }, { id: 'mine', body: 'c' }])
      .execute()
    expect(await db.selectFrom('notes').select(['id', 'body']).orderBy('body').execute()).toEqual([
      { id: 'n1', body: 'a' },
      { id: 'n2', body: 'b' },
      { id: 'mine', body: 'c' },
    ])
    // The column is optional on insert.
    expectTypeOf<{ body: string }>().toMatchTypeOf<
      Parameters<ReturnType<typeof db.insertInto<'notes'>>['values']>[0]
    >()
  })

  it('sets $onUpdate on update and upsert, not on insert or when given', async () => {
    const db = make()
    await db.insertInto('notes').values({ id: 'x', body: 'a' }).execute()
    const editedBy = async () =>
      (await db.selectFrom('notes').select('editedBy').executeTakeFirstOrThrow()).editedBy
    expect(await editedBy()).toBeNull()

    editor = 'grace'
    await db.updateTable('notes').set({ body: 'b' }).execute()
    expect(await editedBy()).toBe('grace')

    await db.updateTable('notes').set({ body: 'c', editedBy: 'me' }).execute()
    expect(await editedBy()).toBe('me')

    editor = 'linus'
    await db
      .insertInto('notes')
      .values({ id: 'x', body: 'd' })
      .onConflict((oc) => oc.column('id').doUpdateSet({ body: 'd' }))
      .execute()
    expect(await editedBy()).toBe('linus')
  })

  it('leaves the schema alone: no database default', () => {
    const snap = extractSnapshot(schema, 'sqlite')
    expect(snap.tables.notes.columns.id.default).toBeNull()
    expect(snap.tables.notes.columns.editedBy.default).toBeNull()
  })
})
