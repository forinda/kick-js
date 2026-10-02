/**
 * Read replicas (D.12). Primary and replicas here are separate in-memory
 * SQLite databases with no replication between them, so which one a query
 * went to is visible in what it returns.
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
  type SchemaSnapshot,
} from '@forinda/kickjs-db'
import { sqliteDialect } from '@forinda/kickjs-db/sqlite'

const notes = table('notes', { id: serial().primaryKey(), body: text().notNull().unique() })
const schema = { notes }

function database(label?: string) {
  const db = new Database(':memory:')
  const empty: SchemaSnapshot = { version: 1, dialect: 'sqlite', tables: {} }
  const target = extractSnapshot(schema, 'sqlite')
  db.exec(emitSqlite(diff(empty, target), { from: empty, to: target }))
  // Each replica holds one row naming it, so a read shows where it went.
  if (label) db.prepare('insert into notes (body) values (?)').run(label)
  return db
}

const bodies = (rows: { body: string }[]) => rows.map((r) => r.body)

describe('read replicas', () => {
  it('reads go to the replica, writes to the primary', async () => {
    const db = createDbClient({
      schema,
      dialect: sqliteDialect({ database: database() }),
      replica: sqliteDialect({ database: database('from replica') }),
    })
    await db.insertInto('notes').values({ body: 'written' }).execute()

    expect(bodies(await db.selectFrom('notes').select('body').execute())).toEqual(['from replica'])
    expect(bodies(await db.query.notes.findMany())).toEqual(['from replica'])
    // Read your own writes through db.primary.
    expect(bodies(await db.primary.selectFrom('notes').select('body').execute())).toEqual([
      'written',
    ])
    expect(bodies(await db.primary.query.notes.findMany())).toEqual(['written'])
  })

  it('a transaction reads and writes the primary only', async () => {
    const db = createDbClient({
      schema,
      dialect: sqliteDialect({ database: database() }),
      replica: sqliteDialect({ database: database('from replica') }),
    })
    const inside = await db.transaction(async () => {
      await db.insertInto('notes').values({ body: 'in tx' }).execute()
      return bodies(await db.selectFrom('notes').select('body').execute())
    })
    expect(inside).toEqual(['in tx'])
  })

  it('several replicas take reads in turn', async () => {
    const db = createDbClient({
      schema,
      dialect: sqliteDialect({ database: database() }),
      replica: [
        sqliteDialect({ database: database('a') }),
        sqliteDialect({ database: database('b') }),
      ],
    })
    const seen = []
    for (let i = 0; i < 4; i++)
      seen.push(...bodies(await db.selectFrom('notes').select('body').execute()))
    expect(seen).toEqual(['a', 'b', 'a', 'b'])
  })

  it('findOrCreate and upsert read the primary', async () => {
    const db = createDbClient({
      schema,
      dialect: sqliteDialect({ database: database() }),
      replica: sqliteDialect({ database: database('lagging') }),
    })
    const first = await db.findOrCreate('notes', { where: { body: 'x' } })
    const second = await db.findOrCreate('notes', { where: { body: 'x' } })
    expect([first.created, second.created]).toEqual([true, false])
    expect(second.row.id).toBe(first.row.id)
  })

  it('without replicas, db.primary is the client itself', () => {
    const db = createDbClient({ schema, dialect: sqliteDialect({ database: database() }) })
    expect(db.primary).toBe(db)
  })
})
