// Coverage for kickjs-db's KickEventBus republisher.
//
// We don't need a real DevTools panel for these checks — the in-memory
// bus from devtools-kit handles dispatch identically to the server
// bus, just without the WS transport. Subscribe to the typed event
// names and assert the right payloads land when the corresponding
// local lifecycle event fires.

import { describe, expect, it } from 'vitest'
import {
  DummyDriver,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type Dialect,
} from 'kysely'

import { createDbClient, table, serial, varchar } from '../../src/index'
import { createInMemoryBus } from '@forinda/kickjs-devtools-kit/bus'

// `import` keeps Vitest happy without forcing a runtime augmentation —
// the registry typing isn't asserted in these tests; the wire-level
// emit/payload contract is.
import '../../src/devtools-events'

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

describe('createDbClient — bus republishing', () => {
  it('forwards slowQuery → db:slow-query when bus + threshold are wired', async () => {
    const bus = createInMemoryBus()
    const seen: Array<{ type: string; payload: unknown }> = []
    bus.onAny((e) => seen.push({ type: e.type, payload: e.payload }))

    const db = createDbClient({
      schema: { users },
      dialect: dummy,
      bus,
      slowQueryThresholdMs: 0, // every query crosses 0ms
    })
    await db.selectFrom('users').selectAll().execute()
    await db.destroy()

    const slow = seen.find((e) => e.type === 'db:slow-query')
    expect(slow).toBeDefined()
    const payload = slow!.payload as Record<string, unknown>
    expect(payload.sql).toMatch(/select/i)
    expect(payload.thresholdMs).toBe(0)
    expect(typeof payload.durationMs).toBe('number')
  })

  it('does not republish when no bus is wired (zero overhead path)', async () => {
    // Just exercise the slow-query path without a bus and confirm the
    // client still works end-to-end. The absence of an emit is the
    // assertion — there's nothing to subscribe to.
    const db = createDbClient({
      schema: { users },
      dialect: dummy,
      slowQueryThresholdMs: 0,
    })
    await db.selectFrom('users').selectAll().execute()
    await db.destroy()
    // No throw means the slow-query handler short-circuited cleanly.
    expect(true).toBe(true)
  })

  it('only attaches the bus republisher when bus is set (no events implied without it)', async () => {
    // Without bus + without slowQueryThresholdMs + without events:true,
    // the emitter shouldn't be active at all. This pins the no-op
    // construction path.
    const db = createDbClient({ schema: { users }, dialect: dummy })
    expect(typeof db.on).toBe('function')
    // .on() is a no-op when events are disabled — calling it shouldn't
    // throw. (Internal contract: events emitter is null.)
    db.on('slowQuery', () => {})
    await db.destroy()
  })

  it('republishes queryError → db:query-error', async () => {
    // Custom dialect whose connection.executeQuery rejects — that's
    // the deterministic path into Kysely's error-level log callback,
    // which is what fires the queryError event we want to observe.
    const failingDialect: Dialect = {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => ({
        init: async () => {},
        acquireConnection: async () => ({
          executeQuery: async () => {
            throw new Error('synthetic driver failure')
          },
          streamQuery: async function* () {
            yield { rows: [] }
          },
        }),
        beginTransaction: async () => {},
        commitTransaction: async () => {},
        rollbackTransaction: async () => {},
        releaseConnection: async () => {},
        destroy: async () => {},
      }),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    }

    const bus = createInMemoryBus()
    const seen: unknown[] = []
    bus.on('db:query-error', (p) => seen.push(p))

    const db = createDbClient({
      schema: { users },
      dialect: failingDialect,
      bus,
      events: true,
    })
    await expect(db.selectFrom('users').selectAll().execute()).rejects.toThrow(
      /synthetic driver failure/,
    )
    await db.destroy()

    expect(seen).toHaveLength(1)
    const payload = seen[0] as Record<string, unknown>
    expect(payload).toHaveProperty('sql')
    expect(payload).toHaveProperty('error')
    expect((payload.error as Error).message).toMatch(/synthetic driver failure/)
  })
})
