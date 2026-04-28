import { describe, it, expect, vi } from 'vitest'
import {
  DummyDriver,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type Dialect,
} from 'kysely'

import { createDbClient, table, serial, varchar } from '../../src/index'

// Dummy dialect — Kysely's plumbing fires `log` on the way through
// even when the driver no-ops. That's enough to verify the
// pre-success path emits `query` with the compiled SQL + params.
const dummy: Dialect = {
  createAdapter: () => new PostgresAdapter(),
  createDriver: () => new DummyDriver(),
  createIntrospector: (db) => new PostgresIntrospector(db),
  createQueryCompiler: () => new PostgresQueryCompiler(),
}

const users = table('users', {
  id: serial().primaryKey(),
  email: varchar(255).notNull(),
})
const schema = { users }

describe('createDbClient lifecycle hooks', () => {
  it('emits `query` after a successful query with compiled SQL + params + duration', async () => {
    const onQuery = vi.fn()
    const db = createDbClient({ schema, dialect: dummy, events: true })
    db.on('query', onQuery)

    await db.selectFrom('users').selectAll().where('email', '=', 'a@b.com').execute()

    expect(onQuery).toHaveBeenCalledTimes(1)
    const payload = onQuery.mock.calls[0][0] as {
      sql: string
      parameters: readonly unknown[]
      durationMs: number
    }
    expect(payload.sql).toMatch(/select \* from "users" where "email" = \$1/i)
    expect(payload.parameters).toEqual(['a@b.com'])
    expect(typeof payload.durationMs).toBe('number')
    expect(payload.durationMs).toBeGreaterThanOrEqual(0)

    await db.destroy()
  })

  it('does NOT install the log callback when events are disabled (zero overhead)', async () => {
    // Spy on the kysely instance after the fact: when events are off,
    // `kysely.log` is left at default (no callback). We exercise this
    // indirectly by confirming there's no listener to call.
    const db = createDbClient({ schema, dialect: dummy }) // no `events`
    const onQuery = vi.fn()
    db.on('query', onQuery)

    await db.selectFrom('users').selectAll().execute()

    // No emitter was attached, so `db.on()` was a no-op. The listener
    // never fires.
    expect(onQuery).not.toHaveBeenCalled()
    await db.destroy()
  })

  it('emits `slowQuery` on top of `query` when duration >= threshold', async () => {
    const onQuery = vi.fn()
    const onSlow = vi.fn()
    // 0ms threshold guarantees every query qualifies as slow.
    const db = createDbClient({
      schema,
      dialect: dummy,
      events: true,
      slowQueryThresholdMs: 0,
    })
    db.on('query', onQuery)
    db.on('slowQuery', onSlow)

    await db.selectFrom('users').selectAll().execute()

    expect(onQuery).toHaveBeenCalledTimes(1)
    expect(onSlow).toHaveBeenCalledTimes(1)
    const slowPayload = onSlow.mock.calls[0][0] as { thresholdMs: number; durationMs: number }
    expect(slowPayload.thresholdMs).toBe(0)
    expect(slowPayload.durationMs).toBeGreaterThanOrEqual(0)
    await db.destroy()
  })

  it('does NOT emit `slowQuery` when duration is below threshold', async () => {
    const onSlow = vi.fn()
    // Set the threshold absurdly high — DummyDriver returns
    // synchronously so duration is sub-millisecond.
    const db = createDbClient({
      schema,
      dialect: dummy,
      events: true,
      slowQueryThresholdMs: 60_000,
    })
    db.on('slowQuery', onSlow)

    await db.selectFrom('users').selectAll().execute()

    expect(onSlow).not.toHaveBeenCalled()
    await db.destroy()
  })

  it('slowQueryThresholdMs implies events without explicit `events: true`', async () => {
    const onSlow = vi.fn()
    const db = createDbClient({
      schema,
      dialect: dummy,
      slowQueryThresholdMs: 0,
    })
    db.on('slowQuery', onSlow)

    await db.selectFrom('users').selectAll().execute()

    expect(onSlow).toHaveBeenCalledTimes(1)
    await db.destroy()
  })
})
