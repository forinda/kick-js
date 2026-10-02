/**
 * `db.upsert()` and `db.findOrCreate()` on SQLite.
 */
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { sql } from 'kysely'
import {
  boolean,
  createDbClient,
  diff,
  emitSqlite,
  extractSnapshot,
  integer,
  serial,
  table,
  text,
  varchar,
} from '@forinda/kickjs-db'
import { sqliteDialect } from '@forinda/kickjs-db/sqlite'

const users = table('users', {
  id: serial().primaryKey(),
  email: varchar(255).notNull().unique(),
  name: text().notNull(),
  visits: integer().notNull().default(0),
})
const handles = table('handles', {
  id: serial().primaryKey(),
  handle: text().notNull(),
  active: boolean().notNull(),
  owner: text().notNull(),
})
const pageViews = table('page_views', { path: text().primaryKey(), views: integer().notNull() })
const schema = { users, handles, pageViews }

function make() {
  const database = new Database(':memory:')
  const empty = { version: 1 as const, dialect: 'sqlite' as const, tables: {} }
  const target = extractSnapshot(schema, 'sqlite')
  database.exec(emitSqlite(diff(empty, target), { from: empty, to: target }))
  // A partial unique index: one ACTIVE row per handle.
  database.exec('CREATE UNIQUE INDEX handles_active ON handles (handle) WHERE active = 1')
  return createDbClient({ schema, dialect: sqliteDialect({ database }) })
}

describe('upsert on SQLite', () => {
  it('inserts, then updates the same key and keeps the id', async () => {
    const db = make()
    const first = await db.upsert('users', {
      values: { email: 'a@x.com', name: 'Ada' },
      target: ['email'],
    })
    expect(first).toMatchObject({ id: 1, email: 'a@x.com', name: 'Ada' })

    const second = await db.upsert('users', {
      values: { email: 'a@x.com', name: 'Ada L.' },
      target: ['email'],
    })
    expect(second).toMatchObject({ id: 1, name: 'Ada L.' })
    expect(await db.selectFrom('users').selectAll().execute()).toHaveLength(1)
  })

  it('updates only the listed columns, or fixed values', async () => {
    const db = make()
    await db.upsert('users', {
      values: { email: 'a@x.com', name: 'Ada', visits: 1 },
      target: ['email'],
    })

    const listed = await db.upsert('users', {
      values: { email: 'a@x.com', name: 'ignored', visits: 5 },
      target: ['email'],
      update: ['visits'],
    })
    expect(listed).toMatchObject({ name: 'Ada', visits: 5 })

    const fixed = await db.upsert('users', {
      values: { email: 'a@x.com', name: 'x' },
      target: ['email'],
      update: { name: 'Fixed' },
    })
    expect(fixed).toMatchObject({ name: 'Fixed', visits: 5 })

    const none = await db.upsert('users', {
      values: { email: 'a@x.com', name: 'y' },
      target: ['email'],
      update: [],
    })
    expect(none).toMatchObject({ name: 'Fixed' })
  })

  it('takes many rows, new and existing', async () => {
    const db = make()
    await db.upsert('users', { values: { email: 'a@x.com', name: 'Ada' }, target: ['email'] })
    const rows = await db.upsert('users', {
      values: [
        { email: 'a@x.com', name: 'Ada 2' },
        { email: 'b@x.com', name: 'Bob' },
      ],
      target: ['email'],
    })
    expect(rows.map((r) => [r.email, r.name])).toEqual([
      ['a@x.com', 'Ada 2'],
      ['b@x.com', 'Bob'],
    ])
  })

  it('counts with an expression in update', async () => {
    const db = make()
    const visit = () =>
      db.upsert('page_views', {
        values: { path: '/home', views: 1 },
        target: ['path'],
        update: { views: sql`page_views.views + 1` },
      })
    await visit()
    await visit()
    expect(await visit()).toEqual({ path: '/home', views: 3 })
  })

  it('targets a partial unique index with where', async () => {
    const db = make()
    // Written as the index's own predicate, with a literal — a bound parameter can't be matched to it.
    const where = () => sql<boolean>`active = 1`
    await db.upsert('handles', {
      values: { handle: 'ada', active: true, owner: 'one' },
      target: ['handle'],
      where,
    })
    const again = await db.upsert('handles', {
      values: { handle: 'ada', active: true, owner: 'two' },
      target: ['handle'],
      where,
    })
    expect(again).toMatchObject({ id: 1, owner: 'two' })
  })
})

describe('findOrCreate on SQLite', () => {
  it('creates once, then finds', async () => {
    const db = make()
    const a = await db.findOrCreate('users', {
      where: { email: 'a@x.com' },
      create: { name: 'Ada' },
    })
    expect(a).toMatchObject({ created: true, row: { email: 'a@x.com', name: 'Ada' } })
    const b = await db.findOrCreate('users', {
      where: { email: 'a@x.com' },
      create: { name: 'Other' },
    })
    expect(b).toMatchObject({ created: false, row: { id: a.row.id, name: 'Ada' } })
  })

  it('works inside a transaction', async () => {
    const db = make()
    await db.transaction(async () => {
      const { created } = await db.findOrCreate('users', {
        where: { email: 't@x.com' },
        create: { name: 'T' },
      })
      expect(created).toBe(true)
    })
    expect(await db.selectFrom('users').select('email').execute()).toEqual([{ email: 't@x.com' }])
  })

  it('rethrows a conflict on a different unique key', async () => {
    const db = make()
    await db.insertInto('users').values({ email: 'a@x.com', name: 'Ada' }).execute()
    // where matches nothing, but create collides on email.
    await expect(
      db.findOrCreate('users', { where: { name: 'Nobody' }, create: { email: 'a@x.com' } }),
    ).rejects.toThrow(/unique|duplicate/i)
  })
})
