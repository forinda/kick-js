/**
 * Dates on SQLite: `timestamp()` / `date()` columns are typed `Date`, so they
 * read back as `Date` and accept a `Date` anywhere — values, updates, where
 * clauses, raw SQL.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { sql } from 'kysely'
import {
  createDbClient,
  customType,
  date,
  diff,
  emitSqlite,
  extractSnapshot,
  serial,
  table,
  text,
  timestamp,
} from '@forinda/kickjs-db'
import { sqliteDialect } from '@forinda/kickjs-db/sqlite'

// A custom codec on a timestamp-typed column still wins over the built-in one.
const epoch = customType<Date>({
  dataType: () => 'integer',
  toDriver: (d) => d.getTime(),
  fromDriver: (n) => new Date(Number(n)),
})

const events = table('events', {
  id: serial().primaryKey(),
  name: text().notNull(),
  at: timestamp().notNull(),
  day: date(),
  createdAt: timestamp().notNull().defaultNow(),
  stamp: epoch(),
})
const schema = { events }

let database: Database.Database
let db: ReturnType<typeof make>
const make = () => createDbClient({ schema, dialect: sqliteDialect({ database }) })

beforeAll(() => {
  database = new Database(':memory:')
  const empty = { version: 1 as const, dialect: 'sqlite' as const, tables: {} }
  const target = extractSnapshot(schema, 'sqlite')
  database.exec(emitSqlite(diff(empty, target), { from: empty, to: target }))
  db = make()
})
afterAll(() => db.destroy())

describe('dates on SQLite', () => {
  it('writes Dates and reads Dates back — including a defaultNow() column', async () => {
    const at = new Date('2026-03-04T05:06:07.089Z')
    const row = await db
      .insertInto('events')
      .values({ name: 'a', at, day: new Date('2026-03-04T00:00:00Z'), stamp: at })
      .returningAll()
      .executeTakeFirstOrThrow()
    expect(row.at).toEqual(at)
    expect(row.day).toEqual(new Date('2026-03-04T00:00:00Z'))
    expect(row.createdAt).toBeInstanceOf(Date)
    expect(Math.abs(row.createdAt.getTime() - Date.now())).toBeLessThan(5000)
    expect(row.stamp).toEqual(at) // the custom codec, not the built-in one
    const stored = database.prepare('select at, day, stamp from events where id = ?').get(row.id)
    expect(stored).toEqual({
      at: '2026-03-04 05:06:07.089',
      day: '2026-03-04',
      stamp: at.getTime(),
    })
  })

  it('accepts Dates in updates, where clauses and raw SQL', async () => {
    const later = new Date('2026-05-01T00:00:00.000Z')
    await db.updateTable('events').set({ at: later }).where('name', '=', 'a').execute()
    const found = await db
      .selectFrom('events')
      .select('name')
      .where('at', '>', new Date('2026-04-01T00:00:00Z'))
      .execute()
    expect(found).toEqual([{ name: 'a' }])
    const { rows } = await sql<{
      n: number
    }>`select count(*) as n from events where at = ${later}`.execute(db.qb)
    expect(rows[0]!.n).toBe(1)
  })

  it('compares a date() column with a Date by calendar day', async () => {
    await db
      .insertInto('events')
      .values({ name: 'dayed', at: new Date(), day: new Date('2026-07-09T00:00:00Z') })
      .execute()
    const day = new Date('2026-07-09T00:00:00Z')
    const eq = await db.selectFrom('events').select('name').where('day', '=', day).execute()
    expect(eq.map((r) => r.name)).toEqual(['dayed'])
    const range = await db
      .selectFrom('events')
      .select('name')
      .where('day', '>=', day)
      .where('day', '<=', day)
      .execute()
    expect(range.map((r) => r.name)).toEqual(['dayed'])
    const within = await db.selectFrom('events').select('name').where('day', 'in', [day]).execute()
    expect(within.map((r) => r.name)).toEqual(['dayed'])
  })

  it('defaultNow() stores milliseconds, so rows inserted together still sort', async () => {
    await db.insertInto('events').values({ name: 'first', at: new Date() }).execute()
    const [{ stored }] = await sql<{
      stored: string
    }>`select "createdAt" as stored from events where name = 'first'`
      .execute(db.qb)
      .then((r) => r.rows)
    expect(stored).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/)
  })

  it('sorts stored timestamps chronologically, old CURRENT_TIMESTAMP values included', async () => {
    database.exec("insert into events (name, at) values ('old', '2026-05-01 00:00:00')")
    await db
      .insertInto('events')
      .values({ name: 'new', at: new Date('2026-05-01T00:00:00.500Z') })
      .execute()
    const order = await db
      .selectFrom('events')
      .select('name')
      .where('name', 'in', ['old', 'new'])
      .orderBy('at')
      .execute()
    expect(order.map((r) => r.name)).toEqual(['old', 'new'])
  })
})
