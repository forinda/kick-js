/**
 * `.stream()` on SQLite: rows in order, `break` releases the connection, a
 * query inside the loop waits for the stream, and an NDJSON body built from it.
 */
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  createDbClient,
  diff,
  emitSqlite,
  extractSnapshot,
  serial,
  table,
  text,
} from '@forinda/kickjs-db'
import { sqliteDialect } from '@forinda/kickjs-db/sqlite'

const events = table('events', { id: serial().primaryKey(), name: text().notNull() })
const schema = { events }

async function seeded(n: number) {
  const database = new Database(':memory:')
  const empty = { version: 1 as const, dialect: 'sqlite' as const, tables: {} }
  const target = extractSnapshot(schema, 'sqlite')
  database.exec(emitSqlite(diff(empty, target), { from: empty, to: target }))
  const db = createDbClient({ schema, dialect: sqliteDialect({ database }) })
  await db
    .insertInto('events')
    .values(Array.from({ length: n }, (_, i) => ({ name: `e${i + 1}` })))
    .execute()
  return db
}

describe('.stream() on SQLite', () => {
  it('yields every row, in order', async () => {
    const db = await seeded(1200)
    let count = 0
    let last = 0
    for await (const row of db.selectFrom('events').selectAll().orderBy('id').stream(500)) {
      expect(row.id).toBe(last + 1)
      last = row.id
      count++
    }
    expect(count).toBe(1200)
  })

  it('break closes the stream; the connection works afterwards', async () => {
    const db = await seeded(100)
    for await (const row of db.selectFrom('events').selectAll().orderBy('id').stream()) {
      if (row.id === 3) break
    }
    const rows = await db.selectFrom('events').select('id').where('id', '=', 50).execute()
    expect(rows).toEqual([{ id: 50 }])
  })

  it('a query inside the loop waits for the stream to end — awaiting it there never returns', async () => {
    const db = await seeded(10)
    let pending: Promise<unknown> | undefined
    let settledInLoop = false
    for await (const _row of db.selectFrom('events').selectAll().stream()) {
      pending = db.selectFrom('events').select('id').where('id', '=', 1).execute()
      pending.then(() => (settledInLoop = true))
      await new Promise((r) => setTimeout(r, 100))
      break
    }
    // Still queued behind the stream while the loop ran; done once it closed.
    expect(settledInLoop).toBe(false)
    await expect(pending).resolves.toEqual([{ id: 1 }])
  })

  it('becomes an NDJSON body', async () => {
    const db = await seeded(3)
    const rows = db.selectFrom('events').select(['id', 'name']).orderBy('id').stream()
    const encoder = new TextEncoder()
    const body = ReadableStream.from(
      (async function* () {
        for await (const row of rows) yield encoder.encode(`${JSON.stringify(row)}\n`)
      })(),
    )
    const text = await new Response(body).text()
    expect(text).toBe('{"id":1,"name":"e1"}\n{"id":2,"name":"e2"}\n{"id":3,"name":"e3"}\n')
  })

  it('cancelling the body — a client that disconnects — closes the stream', async () => {
    const db = await seeded(100)
    const rows = db.selectFrom('events').select('id').orderBy('id').stream()
    let closed = false
    const body = ReadableStream.from(
      (async function* () {
        try {
          for await (const row of rows) yield `${row.id}\n`
        } finally {
          closed = true
        }
      })(),
    )
    const reader = body.getReader()
    await reader.read()
    await reader.cancel()
    expect(closed).toBe(true)
    // The connection is free again.
    await expect(
      db.selectFrom('events').select('id').where('id', '=', 7).execute(),
    ).resolves.toEqual([{ id: 7 }])
  })
})
