/**
 * D.24: Postgres column types with driver codecs — pgvector's `vector` and
 * `halfvec`, `point` — and `macaddr`, against a pgvector-enabled Postgres.
 */
import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from 'vitest'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'
import {
  createDbClient,
  diff,
  emitPg,
  extractSnapshot,
  integer,
  introspectPg,
  relations,
  serial,
  table,
  text,
} from '@forinda/kickjs-db'
import { halfvec, macaddr, pgDialect, point, vector } from '@forinda/kickjs-db/pg'
import { insertSchema } from '@forinda/kickjs-db/schema'

const places = table('places', {
  id: serial().primaryKey(),
  embedding: vector(3).notNull(),
  compact: halfvec(3),
  location: point(),
  device: macaddr(),
})
const visits = table('visits', {
  id: serial().primaryKey(),
  placeId: integer().notNull(),
  at: point().notNull(),
})
const placeRelations = relations(places, ({ many }) => ({ visits: many(visits) }))
const visitRelations = relations(visits, ({ one }) => ({
  place: one(places, { fields: [visits.placeId], references: [places.id] }),
}))
const schema = { places, visits, placeRelations, visitRelations }

let container: StartedPostgreSqlContainer
let pool: pg.Pool

beforeAll(async () => {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg16').start()
  pool = new pg.Pool({ connectionString: container.getConnectionUri() })
  await pool.query('CREATE EXTENSION IF NOT EXISTS vector')
  const empty = { version: 1 as const, dialect: 'postgres' as const, tables: {} }
  await pool.query(emitPg(diff(empty, extractSnapshot(schema, 'postgres'))))
}, 180_000)
afterAll(async () => {
  await pool?.end()
  await container?.stop()
}, 60_000)

describe('Postgres types with codecs', () => {
  it('writes and reads vectors, points and MAC addresses as JS values', async () => {
    const db = createDbClient({ schema, dialect: pgDialect({ pool }) })
    const { id } = await db
      .insertInto('places')
      .values({
        embedding: [0.1, 0.2, 0.3],
        compact: [1, 2, 3],
        location: { x: 36.8, y: -1.28 },
        device: '08:00:2b:01:02:03',
      })
      .returning('id')
      .executeTakeFirstOrThrow()
    await db
      .insertInto('visits')
      .values({ placeId: id, at: { x: 1, y: 2 } })
      .execute()

    const row = await db.selectFrom('places').selectAll().executeTakeFirstOrThrow()
    expect(row.embedding).toEqual([0.1, 0.2, 0.3])
    expect(row.compact).toEqual([1, 2, 3])
    expect(row.location).toEqual({ x: 36.8, y: -1.28 })
    expect(row.device).toBe('08:00:2b:01:02:03')
    expectTypeOf(row.embedding).toEqualTypeOf<number[]>()
    expectTypeOf(row.location).toEqualTypeOf<{ x: number; y: number } | null>()

    const nested = await db.query.places.findFirst({ with: { visits: true } })
    expect(nested?.visits[0].at).toEqual({ x: 1, y: 2 })
    expect(nested?.embedding).toEqual([0.1, 0.2, 0.3])
  })

  it('validates them, and introspects the types back', async () => {
    const insert = insertSchema(places)
    expect(insert.safeParse({ embedding: [1, 2, 3], location: { x: 1, y: 2 } }).success).toBe(true)
    expect(insert.safeParse({ embedding: ['a'], location: { x: 1 } }).success).toBe(false)

    const live = await introspectPg(pool, { schema: 'public' })
    expect(live.tables.places.columns.location.type).toBe('point')
    expect(live.tables.places.columns.device.type).toBe('macaddr')
  })
})

describe('comments on Postgres', () => {
  it('are created, introspected, and changed', async () => {
    const v1 = {
      notes: table(
        'notes',
        { id: serial().primaryKey(), body: text().comment('Markdown') },
        {
          comment: "Team's notes",
        },
      ),
    }
    const v2 = {
      notes: table('notes', { id: serial().primaryKey(), body: text().comment('Plain text') }),
    }
    const empty = { version: 1 as const, dialect: 'postgres' as const, tables: {} }
    await pool.query(emitPg(diff(empty, extractSnapshot(v1, 'postgres'))))
    let live = await introspectPg(pool, { schema: 'public' })
    expect(live.tables.notes.comment).toBe("Team's notes")
    expect(live.tables.notes.columns.body.comment).toBe('Markdown')

    await pool.query(emitPg(diff(extractSnapshot(v1, 'postgres'), extractSnapshot(v2, 'postgres'))))
    live = await introspectPg(pool, { schema: 'public' })
    expect(live.tables.notes.comment).toBeUndefined()
    expect(live.tables.notes.columns.body.comment).toBe('Plain text')
  })
})
