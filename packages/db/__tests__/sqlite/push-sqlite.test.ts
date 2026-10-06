/**
 * D.28: `pushSchema()` on SQLite — the dialect whose introspection loses the
 * most (uuid reads back as text, defaults rewritten), so a second push must
 * still find nothing to do.
 */
import { afterEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { integer, pushSchema, table, text, uuid, varchar } from '@forinda/kickjs-db'
import { sqliteAdapter } from '@forinda/kickjs-db/sqlite'
import * as schema from '../setup/push-schema'

const fresh = () => {
  const database = new Database(':memory:')
  database.pragma('foreign_keys = ON')
  return { database, adapter: sqliteAdapter({ database }) }
}
const columns = (database: Database.Database, t: string) =>
  (database.prepare(`pragma table_info(${t})`).all() as { name: string }[]).map((c) => c.name)

afterEach(() => {
  delete process.env.NODE_ENV
})

describe('pushSchema on SQLite', () => {
  it('creates the schema, then finds nothing to do', async () => {
    const { database, adapter } = fresh()
    expect(await pushSchema({ adapter, schema })).toMatchObject({ status: 'pushed' })
    expect(columns(database, 'posts')).toContain('authorId')
    expect(await pushSchema({ adapter, schema })).toEqual({ status: 'no-changes', changeCount: 0 })
  })

  it('applies a change and keeps the rows', async () => {
    const { database, adapter } = fresh()
    const users = table('users', { id: integer().primaryKey(), name: text().notNull() })
    await pushSchema({ adapter, schema: { users } })
    database.exec(`insert into users (id, name) values (1, 'Ada')`)

    const withEmail = table('users', {
      id: integer().primaryKey(),
      name: text().notNull(),
      email: varchar(254),
    })
    expect(await pushSchema({ adapter, schema: { users: withEmail } })).toMatchObject({
      status: 'pushed',
      changeCount: 1,
    })
    expect(database.prepare('select id, name, email from users').all()).toEqual([
      { id: 1, name: 'Ada', email: null },
    ])
  })

  it('asks before losing data, and refuses without a yes', async () => {
    const { database, adapter } = fresh()
    const before = table('users', { id: integer().primaryKey(), name: text(), age: integer() })
    const after = table('users', { id: integer().primaryKey(), name: text() })
    await pushSchema({ adapter, schema: { users: before } })

    await expect(pushSchema({ adapter, schema: { users: after } })).rejects.toThrow(
      'push would lose data — drop column users.age',
    )
    let asked: string[] = []
    await pushSchema({
      adapter,
      schema: { users: after },
      confirmDataLoss: async (losses) => ((asked = losses), true),
    })
    expect(asked).toEqual(['drop column users.age'])
    expect(columns(database, 'users')).toEqual(['id', 'name'])
  })

  it('a rename keeps the column and its data', async () => {
    const { database, adapter } = fresh()
    await pushSchema({
      adapter,
      schema: { users: table('users', { id: integer().primaryKey(), name: text() }) },
    })
    database.exec(`insert into users (id, name) values (1, 'Ada')`)
    await pushSchema({
      adapter,
      schema: { users: table('users', { id: integer().primaryKey(), fullName: text() }) },
      renames: { columns: { 'users.name': 'fullName' } },
    })
    expect(database.prepare('select fullName from users').all()).toEqual([{ fullName: 'Ada' }])
  })

  it('refuses when the database changed outside push', async () => {
    const { database, adapter } = fresh()
    await pushSchema({ adapter, schema })
    database.exec('alter table posts add column extra text')
    await expect(pushSchema({ adapter, schema })).rejects.toThrow(
      /changed since the last push, outside it/,
    )
  })

  it("refuses a database with tables push didn't create", async () => {
    const { database, adapter } = fresh()
    database.exec('create table legacy (id integer primary key)')
    await expect(pushSchema({ adapter, schema })).rejects.toThrow(/tables push didn't create/)
  })

  it('refuses a database with migrations applied', async () => {
    const { adapter } = fresh()
    await adapter.ensureMigrationTables()
    await adapter.recordApplied({
      id: '1_init',
      name: 'init',
      hash: 'x',
      batch: 1,
      direction: 'up',
    })
    await expect(pushSchema({ adapter, schema })).rejects.toThrow(/has migrations applied/)
  })

  it('refuses in production', async () => {
    process.env.NODE_ENV = 'production'
    await expect(pushSchema({ ...fresh(), schema })).rejects.toThrow(/NODE_ENV=production/)
  })

  it('leaves its own table out of introspection', async () => {
    const { adapter } = fresh()
    await pushSchema({ adapter, schema: { t: table('t', { id: uuid().primaryKey() }) } })
    expect(Object.keys((await adapter.introspect()).tables)).toEqual(['t'])
  })
})
