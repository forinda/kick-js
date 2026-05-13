import { describe, expect, it, vi } from 'vitest'
import {
  DummyDriver,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type Dialect,
} from 'kysely'

import {
  createDbClient,
  table,
  serial,
  varchar,
  timestamp,
  type KickDbClient,
} from '@forinda/kickjs-db'
import { safeNullComparison } from '@forinda/kickjs-db/client/plugins'

// M5 follow-up — locks the compiled-SQL shape kickjs's
// `safeNullComparison()` plugin produces when wired through
// `createDbClient({ plugins: [...] })`.
//
// The default (no plugin) compiles `eb('col', '=', null)` to
// `"col" = $1` with the null bound as a parameter — PG evaluates
// the comparison to UNKNOWN under three-valued logic, filtering out
// rows the adopter expected to match. With our plugin, the operator
// becomes `is` / `is not` AND the null operand is emitted inline as
// a literal `null` keyword (no `$N` binding), producing valid
// `WHERE "col" IS NULL` / `WHERE "col" IS NOT NULL` PostgreSQL.
//
// This is intentionally different from Kysely 0.29's upstream
// `SafeNullComparisonPlugin`, which keeps the null operand
// parameterised and produces invalid `WHERE "col" IS $1` SQL —
// locked separately in
// `packages/db-pg/__tests__/integration/kysely-safe-null-broken-pg.test.ts`.

const dummy: Dialect = {
  createAdapter: () => new PostgresAdapter(),
  createDriver: () => new DummyDriver(),
  createIntrospector: (db) => new PostgresIntrospector(db),
  createQueryCompiler: () => new PostgresQueryCompiler(),
}

const users = table('users', {
  id: serial().primaryKey(),
  email: varchar(255).notNull(),
  deletedAt: timestamp(),
})
const schema = { users }

interface QueryPayload {
  sql: string
  parameters: readonly unknown[]
  durationMs: number
}

async function captureSql<DB>(
  db: KickDbClient<DB>,
  exec: () => Promise<unknown>,
): Promise<QueryPayload> {
  const onQuery = vi.fn()
  db.on('query', onQuery)
  await exec()
  expect(onQuery).toHaveBeenCalledTimes(1)
  return onQuery.mock.calls[0][0] as QueryPayload
}

describe('safeNullComparison() — broken default without the plugin', () => {
  it("eb('col', '=', null) compiles to `= $1` with null bound — silently-false comparison", async () => {
    const db = createDbClient({ schema, dialect: dummy, events: true })
    const { sql, parameters } = await captureSql(db, () =>
      db.selectFrom('users').selectAll().where('deletedAt', '=', null).execute(),
    )
    expect(sql).toMatch(/select \* from "users" where "deletedAt" = \$1/i)
    expect(parameters).toEqual([null])
  })

  it("eb('col', '!=', null) compiles to `!= $1` with null bound — silently-false comparison", async () => {
    const db = createDbClient({ schema, dialect: dummy, events: true })
    const { sql, parameters } = await captureSql(db, () =>
      db.selectFrom('users').selectAll().where('deletedAt', '!=', null).execute(),
    )
    expect(sql).toMatch(/select \* from "users" where "deletedAt" != \$1/i)
    expect(parameters).toEqual([null])
  })
})

describe('safeNullComparison() — corrected semantics with the plugin', () => {
  it("eb('col', '=', null) rewrites to `IS NULL` with no bound parameter", async () => {
    const db = createDbClient({
      schema,
      dialect: dummy,
      events: true,
      plugins: [safeNullComparison()],
    })
    const { sql, parameters } = await captureSql(db, () =>
      db.selectFrom('users').selectAll().where('deletedAt', '=', null).execute(),
    )
    expect(sql).toMatch(/select \* from "users" where "deletedAt" is null/i)
    expect(parameters).toEqual([])
  })

  it("eb('col', '!=', null) rewrites to `IS NOT NULL` with no bound parameter", async () => {
    const db = createDbClient({
      schema,
      dialect: dummy,
      events: true,
      plugins: [safeNullComparison()],
    })
    const { sql, parameters } = await captureSql(db, () =>
      db.selectFrom('users').selectAll().where('deletedAt', '!=', null).execute(),
    )
    expect(sql).toMatch(/select \* from "users" where "deletedAt" is not null/i)
    expect(parameters).toEqual([])
  })

  it("eb('col', '<>', null) rewrites to `IS NOT NULL` (same as `!=`)", async () => {
    const db = createDbClient({
      schema,
      dialect: dummy,
      events: true,
      plugins: [safeNullComparison()],
    })
    const { sql, parameters } = await captureSql(db, () =>
      db.selectFrom('users').selectAll().where('deletedAt', '<>', null).execute(),
    )
    expect(sql).toMatch(/select \* from "users" where "deletedAt" is not null/i)
    expect(parameters).toEqual([])
  })

  it('does not touch comparisons against non-null values — only the literal-null rewrite fires', async () => {
    const db = createDbClient({
      schema,
      dialect: dummy,
      events: true,
      plugins: [safeNullComparison()],
    })
    const { sql, parameters } = await captureSql(db, () =>
      db.selectFrom('users').selectAll().where('email', '=', 'a@b.com').execute(),
    )
    expect(sql).toMatch(/select \* from "users" where "email" = \$1/i)
    expect(parameters).toEqual(['a@b.com'])
  })

  it('does not touch operators other than `=` / `!=` / `<>` against null', async () => {
    // Kysely's expression builder rejects most operators against
    // literal null at the type level, but `is` / `is not` against
    // null are valid and the plugin should pass them through
    // unchanged (no double-rewrite).
    const db = createDbClient({
      schema,
      dialect: dummy,
      events: true,
      plugins: [safeNullComparison()],
    })
    const { sql, parameters } = await captureSql(db, () =>
      db.selectFrom('users').selectAll().where('deletedAt', 'is', null).execute(),
    )
    expect(sql).toMatch(/select \* from "users" where "deletedAt" is null/i)
    expect(parameters).toEqual([])
  })
})
