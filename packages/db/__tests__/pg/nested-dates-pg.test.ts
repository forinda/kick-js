/**
 * Rows `db.query` nests under a relation arrive as JSON, so their dates
 * are strings; on Postgres they now decode like the same column read at
 * the top level — `timestamptz`, `timestamp` and `date` alike.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'
import {
  createDbClient,
  date,
  diff,
  emitPg,
  extractSnapshot,
  integer,
  relations,
  serial,
  table,
  timestamp,
  timestamptz,
  varchar,
} from '@forinda/kickjs-db'
import { pgDialect } from '@forinda/kickjs-db/pg'

const users = table('users', { id: serial().primaryKey(), email: varchar(255).notNull() })
const events = table('events', {
  id: serial().primaryKey(),
  userId: integer()
    .notNull()
    .references(() => users.id),
  at: timestamptz().notNull(),
  local: timestamp().notNull(),
  day: date().notNull(),
})
const userRelations = relations(users, ({ many }) => ({ events: many(events) }))
const eventRelations = relations(events, ({ one }) => ({
  user: one(users, { fields: [events.userId], references: [users.id] }),
}))
const schema = { users, events, userRelations, eventRelations }

let container: StartedPostgreSqlContainer
let pool: pg.Pool

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  pool = new pg.Pool({ connectionString: container.getConnectionUri() })
  pool.on('error', () => {})
  const empty = { version: 1 as const, dialect: 'postgres' as const, tables: {} }
  await pool.query(emitPg(diff(empty, extractSnapshot(schema, 'postgres'))))
}, 120_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
}, 60_000)

describe('nested dates on Postgres', () => {
  it('decode like the top-level column', async () => {
    const db = createDbClient({ schema, dialect: pgDialect({ pool }) })
    await db.insertInto('users').values({ email: 'ada@example.com' }).execute()
    await db
      .insertInto('events')
      .values({
        userId: 1,
        at: new Date('2026-03-04T05:06:07.123Z'),
        local: new Date('2026-03-04T05:06:07.123Z'),
        day: new Date('2026-03-04T00:00:00Z'),
      })
      .execute()

    const top = await db.selectFrom('events').selectAll().executeTakeFirstOrThrow()
    const user = await db.query.users.findFirst({ with: { events: true } })
    const nested = user!.events[0]!
    for (const key of ['at', 'local', 'day'] as const) {
      expect(nested[key], key).toBeInstanceOf(Date)
      expect(nested[key], key).toEqual(top[key])
    }
  }, 60_000)
})
