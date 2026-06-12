/**
 * M5.B.2 — evidence lock for the Kysely 0.29 `SafeNullComparisonPlugin`
 * upstream bug on PostgreSQL.
 *
 * Kysely's plugin rewrites `=` / `!=` / `<>` against a literal `null`
 * to `IS` / `IS NOT` at AST level, but keeps the null operand as a
 * `ValueNode` rather than emitting a literal `NULL`. The compiler
 * then parameterises the value, producing `WHERE "col" IS $1` with
 * `$1=null` — invalid PostgreSQL syntax. PG's grammar for the `IS`
 * predicate requires specific keywords / predicates after the
 * operator (`NULL`, `TRUE`, `FALSE`, `UNKNOWN`, `DISTINCT FROM …`),
 * not an arbitrary parameter placeholder.
 *
 * Verified empirically against `postgres:16-alpine` on PR #219.
 * `SELECT 1 WHERE NULL IS $1` with `[null]` returns
 * `syntax error at or near "$1"`. End-to-end through
 * `createDbClient({ plugins: [new SafeNullComparisonPlugin()] })`
 * produces the same error.
 *
 * Consequence: the original `safeNullComparison()` wrapper helper
 * was pulled from the `@forinda/kickjs-db` public surface (it would
 * surface a runtime error rather than a silently-false comparison —
 * arguably worse than the broken default). The additive
 * `plugins?: KyselyPlugin[]` field stays as a generic escape hatch
 * for other plugins; the docstring on
 * `CreateDbClientOptions.plugins` warns against the Kysely
 * null-comparison plugin until upstream emits a literal `NULL`
 * instead of `$1`.
 *
 * Follow-up tracked in the kick-js issue tracker (see the M5.B PR
 * description). If a future Kysely release fixes the transformer
 * (emits literal `NULL` instead of `$1`), one of the assertions
 * below will start failing — that's the signal we can re-introduce
 * a kickjs-side wrapper helper, drop the warning from the
 * `plugins?` docstring, and delete this test.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'
import { SafeNullComparisonPlugin } from 'kysely'

import {
  createDbClient,
  safeNullComparison,
  serial,
  table,
  timestamp,
  varchar,
} from '@forinda/kickjs-db'
import { pgDialect } from '@forinda/kickjs-db-pg'

let container: StartedPostgreSqlContainer
let pool: pg.Pool

const users = table('users', {
  id: serial().primaryKey(),
  email: varchar(255).notNull(),
  deletedAt: timestamp(),
})
const schema = { users }

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  pool = new pg.Pool({
    host: container.getHost(),
    port: container.getMappedPort(5432),
    user: container.getUsername(),
    password: container.getPassword(),
    database: container.getDatabase(),
    max: 4,
  })
  // Idle pg clients receive FATAL 57P01 when the container stops mid-teardown;
  // an unlistened 'error' event becomes a process-level uncaught exception that
  // fails the run AFTER every test passed. Expected teardown noise — swallow.
  pool.on('error', () => {})
}, 90_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
})

beforeEach(async () => {
  await pool.query(`
    DROP TABLE IF EXISTS "users" CASCADE;
    CREATE TABLE "users" (
      id serial PRIMARY KEY,
      email varchar(255) NOT NULL,
      "deletedAt" timestamp
    );
    INSERT INTO "users" (email, "deletedAt") VALUES
      ('live@example.com', NULL),
      ('deleted@example.com', '2026-01-01 00:00:00');
  `)
})

describe('Kysely 0.29 SafeNullComparisonPlugin — broken upstream on PG', () => {
  it('PG rejects raw `WHERE col IS $1` with null-bound param — matches the Kysely-compiled shape', async () => {
    // Raw pg-protocol probe of the exact SQL Kysely's plugin emits.
    // Locks the syntax-error behaviour so any future PG version
    // that starts accepting this form (or any Kysely fix that
    // changes the compiled shape) surfaces here.
    await expect(
      pool.query('SELECT email FROM "users" WHERE "deletedAt" IS $1', [null]),
    ).rejects.toThrow(/syntax error at or near "\$1"/)

    await expect(
      pool.query('SELECT email FROM "users" WHERE "deletedAt" IS NOT $1', [null]),
    ).rejects.toThrow(/syntax error at or near "\$1"/)
  })

  it('SafeNullComparisonPlugin via createDbClient fails end-to-end with the same syntax error', async () => {
    const db = createDbClient({
      schema,
      dialect: pgDialect({ pool }),
      plugins: [new SafeNullComparisonPlugin()],
    })

    await expect(
      db.selectFrom('users').select(['email']).where('deletedAt', '=', null).execute(),
    ).rejects.toThrow(/syntax error at or near "\$1"/)
    // Intentionally do NOT call `db.destroy()` — the dialect shares
    // the `beforeAll`-scoped pool, and destroy() ends it.
  })

  it('explicit `is` / `is not` operators work correctly — the recommended workaround', async () => {
    // The kickjs-db docstring on `CreateDbClientOptions.plugins`
    // points adopters at this pattern. Lock the working alternative
    // so the doc recommendation stays accurate.
    const db = createDbClient({ schema, dialect: pgDialect({ pool }) })

    const liveRows = await db
      .selectFrom('users')
      .select(['email'])
      .where('deletedAt', 'is', null)
      .orderBy('email')
      .execute()
    expect(liveRows).toEqual([{ email: 'live@example.com' }])

    const deletedRows = await db
      .selectFrom('users')
      .select(['email'])
      .where('deletedAt', 'is not', null)
      .orderBy('email')
      .execute()
    expect(deletedRows).toEqual([{ email: 'deleted@example.com' }])
  })

  it('the broken default `= null` returns ZERO rows — three-valued-logic silent filter', async () => {
    // The footgun the plugin was supposed to fix: `col = NULL` (or
    // `col = $1` with null) evaluates to UNKNOWN and filters every
    // row. Lock the silently-false behaviour so the diagnosis stays
    // intact even if Kysely changes its default elsewhere.
    const db = createDbClient({ schema, dialect: pgDialect({ pool }) })

    const rows = await db
      .selectFrom('users')
      .select(['email'])
      .where('deletedAt', '=', null)
      .execute()
    expect(rows).toEqual([])
  })
})

describe('@forinda/kickjs-db safeNullComparison() — working PG behaviour', () => {
  it("eb('col', '=', null) returns rows where deletedAt IS NULL", async () => {
    const db = createDbClient({
      schema,
      dialect: pgDialect({ pool }),
      plugins: [safeNullComparison()],
    })

    const rows = await db
      .selectFrom('users')
      .select(['email'])
      .where('deletedAt', '=', null)
      .orderBy('email')
      .execute()

    expect(rows).toEqual([{ email: 'live@example.com' }])
  })

  it("eb('col', '!=', null) returns rows where deletedAt IS NOT NULL", async () => {
    const db = createDbClient({
      schema,
      dialect: pgDialect({ pool }),
      plugins: [safeNullComparison()],
    })

    const rows = await db
      .selectFrom('users')
      .select(['email'])
      .where('deletedAt', '!=', null)
      .orderBy('email')
      .execute()

    expect(rows).toEqual([{ email: 'deleted@example.com' }])
  })

  it('non-null comparisons stay parameterised (plugin only rewrites the literal-null case)', async () => {
    const db = createDbClient({
      schema,
      dialect: pgDialect({ pool }),
      plugins: [safeNullComparison()],
    })

    const rows = await db
      .selectFrom('users')
      .select(['email'])
      .where('email', '=', 'live@example.com')
      .execute()

    expect(rows).toEqual([{ email: 'live@example.com' }])
  })
})
