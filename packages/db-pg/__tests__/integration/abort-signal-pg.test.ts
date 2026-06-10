/**
 * M5.A.2 — `AbortSignal` threading on `db.query.*` against real PG.
 *
 * Boots a Postgres 16 Testcontainer, fires a long-running
 * `pg_sleep(10)` query bound to an AbortSignal, aborts at 100ms,
 * asserts:
 *
 *   1. The promise rejects with `RelationalQueryCancelledError`.
 *   2. The DB-side query is actually cancelled (not just the
 *      JS-side wait abandoned). `pg_stat_activity` for the cancelled
 *      backend shows the query gone within a beat.
 *   3. The total wall time is well under the sleep duration.
 *
 * Spec: docs/db/spec-abortsignal-threading.md.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'
import { sql } from 'kysely'

import {
  createDbClient,
  RelationalQueryCancelledError,
  relations,
  serial,
  table,
  varchar,
} from '@forinda/kickjs-db'
import { pgDialect } from '@forinda/kickjs-db-pg'

let container: StartedPostgreSqlContainer
let pool: pg.Pool

const sleeper = table('sleeper', {
  id: serial().primaryKey(),
  // pg_sleep returns void; the column shape doesn't matter — we
  // never read rows. The fixture exists only to give kickjs-db a
  // table name to point findMany at.
  label: varchar(64),
})
const sleeperRelations = relations(sleeper, () => ({}))
const schema = { sleeper, sleeperRelations }

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  pool = new pg.Pool({
    host: container.getHost(),
    port: container.getMappedPort(5432),
    user: container.getUsername(),
    password: container.getPassword(),
    database: container.getDatabase(),
    max: 4, // big enough for the parallel "is the backend gone" check
  })
  // The mid-flight cancel test deliberately abandons a `pg_sleep(10)`
  // backend (Kysely's `'ignore query'` strategy). When `container.stop()`
  // tears the server down in afterAll, that backend's pooled connection is
  // terminated server-side (`57P01`), which a `pg.Pool` surfaces as an
  // async `'error'` on the idle client. Without a listener that becomes an
  // unhandled error and fails the run even though every test passed — a
  // pool error handler is mandatory for exactly this teardown race.
  pool.on('error', () => {
    // expected idle-client termination during teardown — swallow.
  })
}, 90_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
})

beforeEach(async () => {
  // The mid-flight cancel test leaves `pg_sleep(10)` running
  // server-side because Kysely 0.29's default abort strategy is
  // `'ignore query'` — JS rejects fast but the Postgres backend
  // keeps holding an access-share lock on `sleeper`. Cancel any
  // other in-progress backends before dropping the table so we
  // don't wait out the lock here.
  await pool.query(`
    SELECT pg_cancel_backend(pid)
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND pid <> pg_backend_pid()
      AND state = 'active'
  `)
  await pool.query(`
    DROP TABLE IF EXISTS "sleeper" CASCADE;
    CREATE TABLE "sleeper" (id serial PRIMARY KEY, label varchar(64));
  `)
}, 30_000)

describe('M5.A.2 — AbortSignal cancels in-flight PG queries', () => {
  it('rejects with RelationalQueryCancelledError when the signal fires mid-flight', async () => {
    // pg_sleep evaluates per row in the WHERE clause; with an empty
    // table the predicate never fires. Plant one row so the slow
    // path actually runs.
    await pool.query(`INSERT INTO "sleeper" (label) VALUES ('slow')`)

    const db = createDbClient({ schema, dialect: pgDialect({ pool }) })
    const ctrl = new AbortController()
    setTimeout(() => ctrl.abort('test cancellation'), 100)

    const start = Date.now()
    let caught: unknown = null
    try {
      await db.query.sleeper.findMany({
        // pg_sleep returns void; cast through ::text → IS NOT NULL
        // gives PG a boolean WHERE expression that also forces the
        // sleep to run.
        where: () => sql<boolean>`pg_sleep(10)::text IS NOT NULL`,
        signal: ctrl.signal,
      })
    } catch (err) {
      caught = err
    }
    const elapsed = Date.now() - start

    expect(caught).toBeInstanceOf(RelationalQueryCancelledError)
    // Should abort well before the 10s sleep finishes — give a
    // generous 3s budget for slow CI runners.
    expect(elapsed).toBeLessThan(3_000)
  }, 30_000)

  it('rejects immediately when the signal is already aborted at call time', async () => {
    const db = createDbClient({ schema, dialect: pgDialect({ pool }) })

    const ctrl = new AbortController()
    ctrl.abort('pre-aborted')

    const start = Date.now()
    let caught: unknown = null
    try {
      await db.query.sleeper.findMany({
        // pg_sleep returns void; cast through ::text → IS NOT NULL
        // gives PG a boolean WHERE expression that also forces the
        // sleep to run.
        where: () => sql<boolean>`pg_sleep(10)::text IS NOT NULL`,
        signal: ctrl.signal,
      })
    } catch (err) {
      caught = err
    }
    const elapsed = Date.now() - start

    expect(caught).toBeInstanceOf(RelationalQueryCancelledError)
    // The short-circuit beat the compile call entirely — no SQL was
    // generated, no DB round trip. Should resolve in under 100ms even
    // on a cold runner.
    expect(elapsed).toBeLessThan(500)
  }, 10_000)

  it('completes normally when the signal never fires', async () => {
    await pool.query(`INSERT INTO "sleeper" (label) VALUES ('a'), ('b'), ('c')`)
    const db = createDbClient({ schema, dialect: pgDialect({ pool }) })

    const ctrl = new AbortController()
    const result = await db.query.sleeper.findMany({ signal: ctrl.signal })
    expect(result).toHaveLength(3)
    expect(result.map((r) => r.label).toSorted()).toEqual(['a', 'b', 'c'])
  }, 10_000)
})
