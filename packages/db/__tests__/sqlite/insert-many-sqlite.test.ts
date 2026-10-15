/**
 * `db.insertMany()` on SQLite: rows past the parameter limit go in as several
 * statements, in one transaction.
 */
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  createDbClient,
  diff,
  emitSqlite,
  extractSnapshot,
  integer,
  sql,
  serial,
  table,
  text,
  varchar,
} from '@forinda/kickjs-db'
import { sqliteDialect } from '@forinda/kickjs-db/sqlite'

const events = table('events', {
  id: serial().primaryKey(),
  code: varchar(64).notNull().unique(),
  kind: text().notNull(),
  weight: integer().notNull(),
})
const schema = { events }

function make() {
  const database = new Database(':memory:')
  const empty = { version: 1 as const, dialect: 'sqlite' as const, tables: {} }
  const target = extractSnapshot(schema, 'sqlite')
  database.exec(emitSqlite(diff(empty, target), { from: empty, to: target }))
  return createDbClient({ schema, dialect: sqliteDialect({ database }), events: true })
}

const rows = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => ({ code: `e-${from + i}`, kind: 'click', weight: i % 7 }))

describe('insertMany on SQLite', () => {
  it('inserts rows whose values pass the 32,766-parameter limit, which one statement cannot', async () => {
    const db = make()
    // 40,000 rows × 3 columns = 120,000 parameters.
    await expect(db.insertInto('events').values(rows(40_000)).execute()).rejects.toThrow(
      /too many SQL variables/i,
    )
    const statements: string[] = []
    db.on('query', (e) => void statements.push(e.sql))
    expect(await db.insertMany('events', rows(40_000))).toBe(40_000)
    const { n } = await db
      .selectFrom('events')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .executeTakeFirstOrThrow()
    expect(Number(n)).toBe(40_000)
    // 10,922 rows per statement (32,766 / 3): four inserts, in a transaction.
    expect(statements.filter((s) => /^insert/i.test(s))).toHaveLength(4)
  })

  it('rolls every statement back when a later one fails', async () => {
    const db = make()
    const batch = [...rows(30_000), { code: 'e-5', kind: 'dup', weight: 0 }] // last chunk conflicts
    await expect(db.insertMany('events', batch)).rejects.toThrow()
    const { n } = await db
      .selectFrom('events')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .executeTakeFirstOrThrow()
    expect(Number(n)).toBe(0)
  })

  it('honours maxParams and atomic: false, as for Cloudflare D1', async () => {
    const db = make()
    const statements: string[] = []
    db.on('query', (e) => void statements.push(e.sql))
    await db.insertMany('events', rows(10), { maxParams: 6, atomic: false }) // 2 rows a statement
    expect(statements.filter((s) => /^insert/i.test(s))).toHaveLength(5)
    expect(statements.some((s) => /^begin/i.test(s))).toBe(false)
    await expect(db.insertMany('events', rows(1, 99), { maxParams: 2 })).rejects.toThrow(
      'more than maxParams',
    )
  })

  it('returns the rows with returning: true, and joins an open transaction', async () => {
    const db = make()
    const inserted = await db
      .transaction(async () => {
        const out = await db.insertMany('events', rows(3), { returning: true, maxParams: 3 })
        throw Object.assign(new Error('roll back'), { out })
      })
      .catch((err: { out: unknown[] }) => err.out)
    expect(inserted).toHaveLength(3)
    expect(inserted[0]).toMatchObject({ code: 'e-0', kind: 'click' })
    // It ran inside the caller's transaction, which rolled back.
    expect(await db.selectFrom('events').selectAll().execute()).toEqual([])
    expect(await db.insertMany('events', [])).toBe(0)
  })

  it('upsert splits many rows too', async () => {
    const db = make()
    await db.insertMany('events', rows(5))
    const updated = await db.upsert('events', {
      values: rows(40_000).map((r) => ({ ...r, kind: 'view' })),
      target: ['code'],
    })
    expect(updated).toHaveLength(40_000)
    const kinds = await db.selectFrom('events').select('kind').distinct().execute()
    expect(kinds).toEqual([{ kind: 'view' }])
  })
  it('counts the parameters the whole statement binds — an update set, expression values', async () => {
    const db = make()
    const sent: number[] = []
    db.on('query', (e) => void (/^insert/i.test(e.sql) && sent.push(e.parameters.length)))
    // 3 per row plus the update's 1: two rows would bind 7, so one per statement.
    await db.upsert('events', {
      values: rows(4),
      target: ['code'],
      update: { weight: 1 },
      maxParams: 6,
    })
    expect(sent).toEqual([4, 4, 4, 4])
    sent.length = 0
    // An expression binding two: 4 per row, so one row per statement.
    const joined = rows(3, 10).map((r) => ({ ...r, kind: sql<string>`${'cl'} || ${'ick'}` }))
    expect(await db.insertMany('events', joined, { maxParams: 6 })).toBe(3)
    expect(sent).toEqual([4, 4, 4])
  })
})
