/**
 * `.stream()` on SQLite: rows in order, `break` releases the connection, a
 * query inside the loop waits for the stream, and an NDJSON body built from it.
 */
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  boolean,
  createDbClient,
  diff,
  emitSqlite,
  extractSnapshot,
  serial,
  table,
  text,
} from '@forinda/kickjs-db'
import { sqliteDialect } from '@forinda/kickjs-db/sqlite'

const events = table('events', {
  id: serial().primaryKey(),
  name: text().notNull(),
  exported: boolean().notNull().default(false),
})

/** The guide's NDJSON body: pull-based, so it runs on Node 20.0 and waits for the reader. */
function ndjson(rows: AsyncIterable<unknown>): ReadableStream<Uint8Array> {
  const it = rows[Symbol.asyncIterator]()
  const encoder = new TextEncoder()
  return new ReadableStream({
    async pull(controller) {
      const { value, done } = await it.next()
      if (done) controller.close()
      else controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`))
    },
    async cancel() {
      await it.return?.()
    },
  })
}
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

  it('writing as you read, in a transaction: a set-based update, or cursor batches', async () => {
    const db = await seeded(1200)
    await db.transaction(async (trx) => {
      const written: number[] = []
      let lastId = 0
      for (;;) {
        const batch = await trx
          .selectFrom('events')
          .selectAll()
          .where('id', '>', lastId)
          .where('id', '<=', 1000)
          .orderBy('id')
          .limit(500)
          .execute()
        if (batch.length === 0) break
        written.push(batch.length)
        await trx
          .updateTable('events')
          .set({ exported: true })
          .where(
            'id',
            'in',
            batch.map((row) => row.id),
          )
          .execute()
        lastId = batch.at(-1)!.id
      }
      expect(written).toEqual([500, 500])
      await trx
        .updateTable('events')
        .set({ exported: true })
        .where('exported', '=', false)
        .execute()
    })
    const left = await db.selectFrom('events').select('id').where('exported', '=', false).execute()
    expect(left).toEqual([])
  })

  it('becomes an NDJSON body', async () => {
    const db = await seeded(3)
    const rows = db.selectFrom('events').select(['id', 'name']).orderBy('id').stream()
    const text = await new Response(ndjson(rows)).text()
    expect(text).toBe('{"id":1,"name":"e1"}\n{"id":2,"name":"e2"}\n{"id":3,"name":"e3"}\n')
  })

  it('cancelling the body — a client that disconnects — closes the stream', async () => {
    const db = await seeded(100)
    const reader = ndjson(db.selectFrom('events').select('id').orderBy('id').stream()).getReader()
    await reader.read()
    await reader.cancel()
    // On SQLite's one connection this query would wait forever if the stream were still open.
    await expect(
      db.selectFrom('events').select('id').where('id', '=', 7).execute(),
    ).resolves.toEqual([{ id: 7 }])
  })
})
