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

// M5.B.2 — locks the compiled-SQL shape the SafeNullComparisonPlugin
// produces when wired through `createDbClient({ plugins: [...] })`.
// The default (no plugin) compiles `eb('col', '=', null)` to
// `"col" = $1` with the null bound as a parameter — PG evaluates the
// comparison to UNKNOWN under three-valued logic, filtering out
// rows the adopter expected to match. With the plugin, Kysely
// rewrites the operator to `IS` / `IS NOT` so the binding behaves as
// `IS NULL` / `IS NOT NULL`.

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
    await db.destroy()
  })

  it("eb('col', '!=', null) compiles to `!= $1` with null bound — silently-false comparison", async () => {
    const db = createDbClient({ schema, dialect: dummy, events: true })
    const { sql, parameters } = await captureSql(db, () =>
      db.selectFrom('users').selectAll().where('deletedAt', '!=', null).execute(),
    )
    expect(sql).toMatch(/select \* from "users" where "deletedAt" != \$1/i)
    expect(parameters).toEqual([null])
    await db.destroy()
  })
})

describe('safeNullComparison() — corrected semantics with the plugin', () => {
  it("eb('col', '=', null) rewrites `=` → `IS` so the binding behaves as IS NULL", async () => {
    const db = createDbClient({
      schema,
      dialect: dummy,
      events: true,
      plugins: [safeNullComparison()],
    })
    const { sql, parameters } = await captureSql(db, () =>
      db.selectFrom('users').selectAll().where('deletedAt', '=', null).execute(),
    )
    expect(sql).toMatch(/select \* from "users" where "deletedAt" is \$1/i)
    expect(parameters).toEqual([null])
    await db.destroy()
  })

  it("eb('col', '!=', null) rewrites `!=` → `IS NOT` so the binding behaves as IS NOT NULL", async () => {
    const db = createDbClient({
      schema,
      dialect: dummy,
      events: true,
      plugins: [safeNullComparison()],
    })
    const { sql, parameters } = await captureSql(db, () =>
      db.selectFrom('users').selectAll().where('deletedAt', '!=', null).execute(),
    )
    expect(sql).toMatch(/select \* from "users" where "deletedAt" is not \$1/i)
    expect(parameters).toEqual([null])
    await db.destroy()
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
    await db.destroy()
  })
})
