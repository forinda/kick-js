/** D.29: generated seed data on SQLite — valid, related, and the same for the same seed. */
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  createDbClient,
  diff,
  emitSqlite,
  extractSnapshot,
  fakeRows,
  seedFake,
} from '@forinda/kickjs-db'
import { sqliteDialect } from '@forinda/kickjs-db/sqlite'
import { pgEnum } from '@forinda/kickjs-db/pg'
import { mysqlEnum } from '@forinda/kickjs-db/mysql'
import { serial, table, text } from '@forinda/kickjs-db'
import * as schema from '../setup/fake-schema'

function fresh() {
  const database = new Database(':memory:')
  database.pragma('foreign_keys = ON')
  const empty = { version: 1 as const, dialect: 'sqlite' as const, tables: {} }
  const target = extractSnapshot(schema, 'sqlite')
  database.exec(emitSqlite(diff(empty, target), { from: empty, to: target }))
  return { database, db: createDbClient({ schema, dialect: sqliteDialect({ database }) }) }
}

describe('seedFake on SQLite', () => {
  it('fills tables parents first, with foreign keys that hold', async () => {
    const { database, db } = fresh()
    const out = await seedFake(db, schema, {
      counts: { post_tags: 12, posts: 8, users: 3, tags: 4 }, // any order
    })
    const count = (t: string) => (database.prepare(`select count(*) n from ${t}`).get() as any).n
    expect([count('users'), count('posts'), count('tags'), count('post_tags')]).toEqual([
      3, 8, 4, 12,
    ])
    expect(database.prepare('pragma foreign_key_check').all()).toEqual([])
    // What the database filled in comes back: serial ids, defaults.
    expect(out.posts!.every((p) => typeof p.id === 'number' && p.views === 0)).toBe(true)
    expect(out.users!.every((u) => u.createdAt)).toBe(true)
    // Every author is one of the users.
    const ids = new Set(out.users!.map((u) => u.id))
    expect(out.posts!.every((p) => ids.has(p.authorId))).toBe(true)
  })

  it('respects lengths and uniqueness', async () => {
    const { db } = fresh()
    const out = await seedFake(db, schema, { counts: { users: 40, tags: 30 } })
    const emails = out.users!.map((u) => u.email as string)
    expect(new Set(emails).size).toBe(40)
    expect(emails.every((e) => e.endsWith('@example.com') && e.length <= 60)).toBe(true)
    expect(out.users!.every((u) => (u.name as string).length <= 12)).toBe(true)
    expect(new Set(out.tags!.map((t) => t.name)).size).toBe(30)
  })

  it('points at rows already there for a table not in counts', async () => {
    const { db } = fresh()
    await seedFake(db, schema, { counts: { users: 2 } })
    const out = await seedFake(db, schema, { counts: { posts: 5 }, seed: 2 })
    const users = await db.selectFrom('users').select('id').execute()
    expect(new Set(out.posts!.map((p) => p.authorId))).toEqual(new Set(users.map((u) => u.id)))
  })

  it('takes overrides, fixed or per row', async () => {
    const { db } = fresh()
    const out = await seedFake(db, schema, {
      counts: { users: 3 },
      overrides: {
        users: { active: true, name: ({ index }: { index: number }) => `user ${index}` },
      },
    })
    expect(out.users!.map((u) => [u.active, u.name])).toEqual([
      [true, 'user 0'],
      [true, 'user 1'],
      [true, 'user 2'],
    ])
  })
})

describe('fakeRows', () => {
  it('gives the same rows for the same seed, and others for another', () => {
    const a = fakeRows(schema.posts, { count: 5, seed: 7, refs: { authorId: ['u1', 'u2'] } })
    const b = fakeRows(schema.posts, { count: 5, seed: 7, refs: { authorId: ['u1', 'u2'] } })
    const c = fakeRows(schema.posts, { count: 5, seed: 8, refs: { authorId: ['u1', 'u2'] } })
    expect(a).toEqual(b)
    expect(a).not.toEqual(c)
    // Left to the database: the serial key and the default.
    expect(a[0]).not.toHaveProperty('id')
    expect(a[0]).not.toHaveProperty('views')
    expect(a[0]!.price).toMatch(/^\d+\.\d{2}$/)
  })

  it('gives a junction distinct pairs', () => {
    const rows = fakeRows(schema.postTags, {
      count: 12,
      refs: { postId: [1, 2, 3], tagId: [1, 2, 3, 4] },
    })
    expect(new Set(rows.map((r) => `${r.postId}:${r.tagId}`)).size).toBe(12)
  })

  it('names a person only on a people table', () => {
    const people = table('authors', { id: serial().primaryKey(), name: text().notNull() })
    const things = table('projects', { id: serial().primaryKey(), name: text().notNull() })
    const person = fakeRows(people, { count: 1 })[0]!.name as string
    const thing = fakeRows(things, { count: 1 })[0]!.name as string
    expect(person).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/) // First Last
    expect(thing).toMatch(/^[A-Z][a-z]+ [a-z]+$/) // Two words
  })

  it('picks enum values, on Postgres and MySQL', () => {
    const status = pgEnum('status', 'todo', 'doing', 'done')
    const t = table('t', {
      id: serial().primaryKey(),
      s: status().notNull(),
      m: mysqlEnum('a', "b'c").notNull(),
    })
    const rows = fakeRows(t, { count: 20 })
    expect(rows.every((r) => ['todo', 'doing', 'done'].includes(r.s as string))).toBe(true)
    expect(new Set(rows.map((r) => r.m))).toEqual(new Set(['a', "b'c"]))
  })

  it('asks for an override where it would have to guess', () => {
    expect(() => fakeRows(schema.notes, { count: 1 })).toThrow(
      "can't make up a value for notes.labels (text) — give it an override",
    )
    expect(() => fakeRows(schema.posts, { count: 1 })).toThrow(
      'posts.authorId points at users — give it rows to point at',
    )
    expect(fakeRows(schema.notes, { count: 1, overrides: { labels: ['a'] } })).toEqual([
      { labels: ['a'] },
    ])
  })
})
