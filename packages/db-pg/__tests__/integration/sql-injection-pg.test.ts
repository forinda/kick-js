/**
 * Architecture-spec §13 hardening — SQL emission threat model.
 *
 * Adversarial-input coverage that empirically locks the trust
 * boundary documented in `docs/db/spec-sql-emission-threat-model.md`:
 *
 *   1. Runtime values that flow through Kysely's `ExpressionBuilder`
 *      MUST be parameter-bound. Adversarial strings containing every
 *      common SQL-injection attack class round-trip byte-identical
 *      via insert + select, proving no out-of-band SQL executes.
 *
 *   2. Identifiers that flow through `quoteIdent` produce SQL that
 *      PG accepts as a single identifier — even when the identifier
 *      itself contains quotes / SQL keywords. (This guards against
 *      future schemas where the table name is somehow derived from
 *      runtime data; today's schemas are code-time-controlled, but
 *      the defensive escape should still hold.)
 *
 * A regression on either property surfaces here, against a real
 * postgres:16-alpine Testcontainer.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'

import {
  createDbClient,
  diff,
  emitPg,
  introspectPg,
  serial,
  table,
  varchar,
} from '@forinda/kickjs-db'
import { pgDialect } from '@forinda/kickjs-db-pg'

let container: StartedPostgreSqlContainer
let pool: pg.Pool

const users = table('users', {
  id: serial().primaryKey(),
  payload: varchar(2048).notNull(),
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
}, 90_000)

afterAll(async () => {
  await pool?.end()
  await container?.stop()
})

beforeEach(async () => {
  await pool.query(`DROP TABLE IF EXISTS "users" CASCADE`)
  await pool.query(`
    CREATE TABLE "users" (
      "id" serial PRIMARY KEY,
      "payload" varchar(2048) NOT NULL
    )
  `)
})

// Adversarial values covering every distinct SQL-injection attack
// class. If parameter binding is uniformly applied across operators
// and dialects, ALL of these round-trip identically. A single
// failure reveals exactly which class slipped through.
const ADVERSARIAL_VALUES = [
  // Classic single-quote escape — break out of a quoted literal.
  "O'Brien",
  // Double-quote delimiter — identifier escape in standard SQL.
  'say "hi"',
  // PG dollar-quoting alternative literal form.
  'value $$dollar quoted$$ tail',
  // Statement terminator + DROP injection + comment marker.
  "Robert'); DROP TABLE users; --",
  // pg_sleep injection that would block for 60s if parsed.
  "'); SELECT pg_sleep(60); --",
  // C-style comment block.
  'value /* injected */ tail',
  // Bare line-comment marker.
  'comment-- tail',
  // Nested comment — PG accepts `/* /* */ */`.
  'outer /* /* nested */ */ tail',
  // PG E-string escape sequences.
  'E-string \\n \\047 escape',
  // Backslash + null-ish marker.
  'back\\slash null',
  // EXECUTE/FORMAT keyword combo (only dangerous if reflectively eval).
  "EXECUTE FORMAT('DROP TABLE %I', 'users')",
  // Stacked statements via various delimiters.
  '1;2;3; -- hi',
  // Quoted-identifier injection targeting introspect-style queries.
  `"users"; UPDATE users SET payload = 'pwned'; --`,
  // Boolean-blind algebra.
  "1' OR '1'='1",
  // Subquery injection attempt.
  "name'; SELECT (SELECT MAX(id) FROM users); --",
  // UNION-based injection attempt.
  "union' UNION SELECT NULL, 'pwned' --",
  // Time-based blind injection via WAITFOR-style construct (MSSQL flavour;
  // proves cross-dialect attack vectors don't slip through PG either).
  "1'; WAITFOR DELAY '00:00:30'; --",
  // pg_catalog snooping attempt.
  "x'); SELECT current_database(); --",
  // Encoding tricks: URL-encoded quote (should pass through as bytes).
  '%27 OR 1=1 --',
] as const

describe('SQL emission threat model — runtime values flow through parameter binding', () => {
  for (const value of ADVERSARIAL_VALUES) {
    it(`round-trips adversarial value byte-identical: ${JSON.stringify(value).slice(0, 60)}`, async () => {
      const db = createDbClient({ schema, dialect: pgDialect({ pool }) })

      // Seed a canary so a successful injection (DROP TABLE, UPDATE, etc.)
      // would change the canary row count or value.
      await pool.query(`INSERT INTO "users" (payload) VALUES ('canary')`)

      // Insert the adversarial value via Kysely's typed insert.
      const inserted = await db
        .insertInto('users')
        .values({ payload: value })
        .returningAll()
        .executeTakeFirstOrThrow()
      expect(inserted.payload).toBe(value)

      // Select-by-equality via where('col', '=', value) — proves
      // the value matches itself when round-tripped through the
      // expression-builder + parameter-binding pathway.
      const rows = await db.selectFrom('users').selectAll().where('payload', '=', value).execute()
      expect(rows).toHaveLength(1)
      expect(rows[0]!.payload).toBe(value)

      // Confirm exactly 2 rows: the canary + the adversarial value.
      // A successful DROP / UPDATE / DELETE injection would change
      // this count or alter the canary.
      const all = await pool.query<{ id: number; payload: string }>(
        `SELECT id, payload FROM "users" ORDER BY id`,
      )
      expect(all.rows).toHaveLength(2)
      expect(all.rows[0]!.payload).toBe('canary')
      expect(all.rows[1]!.payload).toBe(value)
    }, 30_000)
  }

  it('round-trips an adversarial value inside an `in (...)` array', async () => {
    // The `in` operator parameter-binds arrays. Adversarial array
    // elements should round-trip just like scalars.
    const db = createDbClient({ schema, dialect: pgDialect({ pool }) })
    const bad = "'); DROP TABLE users; --"

    await db.insertInto('users').values({ payload: bad }).execute()
    await db.insertInto('users').values({ payload: 'safe' }).execute()

    const rows = await db
      .selectFrom('users')
      .selectAll()
      .where('payload', 'in', [bad, 'no match'])
      .execute()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.payload).toBe(bad)

    const total = await pool.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM "users"')
    expect(total.rows[0]!.n).toBe(2)
  }, 30_000)

  it('round-trips adversarial values through `like` pattern matching', async () => {
    // The `like` operator parameter-binds the pattern. A pattern
    // containing `'` or `%` etc must not affect the SQL shape.
    const db = createDbClient({ schema, dialect: pgDialect({ pool }) })
    await db.insertInto('users').values({ payload: "100%' OR 1=1" }).execute()
    await db.insertInto('users').values({ payload: 'safe' }).execute()

    const rows = await db
      .selectFrom('users')
      .selectAll()
      .where('payload', 'like', "%' OR 1=1")
      .execute()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.payload).toBe("100%' OR 1=1")
  }, 30_000)
})

describe('SQL emission threat model — identifier escape', () => {
  it('emit/pg.ts produces SQL PG accepts for a table name containing a double-quote', async () => {
    // Synthetic schema with an identifier containing a `"`. This
    // is not something the DSL constructor typically accepts (it'd
    // reject at the type level), but a malformed introspection
    // result or hand-rolled snapshot could surface one. The escape
    // via `quoteIdent` doubles the internal `"`, producing valid PG.
    const evilSchema = {
      version: 1 as const,
      dialect: 'postgres' as const,
      tables: {
        'weird"name': {
          name: 'weird"name',
          columns: {
            id: {
              name: 'id',
              type: 'serial',
              nullable: false,
              default: null,
              primaryKey: true,
            },
          },
          indexes: [],
          foreignKeys: [],
          checks: [],
        },
      },
    }
    const emptySchema = { version: 1 as const, dialect: 'postgres' as const, tables: {} }
    const createSql = emitPg(diff(emptySchema, evilSchema))

    // Expected emit form: `CREATE TABLE "weird""name" ( ... )`
    // — the inner `"` doubled per the SQL standard.
    expect(createSql).toContain(`"weird""name"`)

    // Acquire a client for introspectPg; release on the way out.
    const client = await pool.connect()
    try {
      for (const stmt of createSql.split(/;\s*\n?/).filter((s) => s.trim().length > 0)) {
        await client.query(stmt + ';')
      }

      const snap = await introspectPg(client as unknown as pg.Client)
      expect(snap.tables['weird"name']).toBeDefined()
      expect(snap.tables['weird"name']?.columns.id).toBeDefined()

      const dropSql = emitPg(diff(evilSchema, emptySchema))
      for (const stmt of dropSql.split(/;\s*\n?/).filter((s) => s.trim().length > 0)) {
        await client.query(stmt + ';')
      }
    } finally {
      client.release()
    }
  }, 30_000)

  it('rejects a deliberately-bad identifier: SQL injection in the table name never escapes quoting', async () => {
    // If `quoteIdent` were broken, this table name would inject
    // a DROP into the surrounding CREATE TABLE statement. Confirm
    // emit wraps it as a single (weird-but-valid) identifier and
    // PG doesn't interpret any of the embedded SQL.
    const evilName = 'evil"; DROP TABLE "users"; CREATE TABLE "x'
    const evilSchema = {
      version: 1 as const,
      dialect: 'postgres' as const,
      tables: {
        [evilName]: {
          name: evilName,
          columns: {
            id: {
              name: 'id',
              type: 'serial',
              nullable: false,
              default: null,
              primaryKey: true,
            },
          },
          indexes: [],
          foreignKeys: [],
          checks: [],
        },
      },
    }
    const emptySchema = { version: 1 as const, dialect: 'postgres' as const, tables: {} }
    const createSql = emitPg(diff(emptySchema, evilSchema))

    // The inner `"` characters in the identifier are each doubled
    // by `quoteIdent` — the entire payload is wrapped as one
    // identifier with internal escaped quotes, not a sequence of
    // statements.
    expect(createSql).toContain(`"evil""; DROP TABLE ""users""; CREATE TABLE ""x"`)

    // Seed `users` so we'd notice if it gets dropped.
    await pool.query(`INSERT INTO "users" (payload) VALUES ('canary')`)

    const dropSql = emitPg(diff(evilSchema, emptySchema))
    try {
      // Pass the full emit as one multi-statement query — pg's
      // simple-query protocol handles `;`-separated statements.
      // Splitting client-side on `;` fails when an identifier
      // contains literal `;` characters (the whole point of this
      // test). PG's parser respects quoted-identifier boundaries.
      await pool.query(createSql)

      // The DROP TABLE injection would have nuked `users` if escape
      // were broken; confirm it didn't.
      const usersCount = await pool.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM "users"')
      expect(usersCount.rows[0]!.n).toBe(1)
    } finally {
      await pool.query(dropSql).catch(() => {})
    }
  }, 30_000)

  it('escapes column names containing quotes through emit/pg.ts', async () => {
    // Same defensive escape, but for column names. Schema-author-
    // controlled at code time today, but the escape should hold.
    const evilSchema = {
      version: 1 as const,
      dialect: 'postgres' as const,
      tables: {
        weird_cols: {
          name: 'weird_cols',
          columns: {
            id: {
              name: 'id',
              type: 'serial',
              nullable: false,
              default: null,
              primaryKey: true,
            },
            'col"with"quotes': {
              name: 'col"with"quotes',
              type: 'text',
              nullable: true,
              default: null,
              primaryKey: false,
            },
          },
          indexes: [],
          foreignKeys: [],
          checks: [],
        },
      },
    }
    const emptySchema = { version: 1 as const, dialect: 'postgres' as const, tables: {} }
    const createSql = emitPg(diff(emptySchema, evilSchema))

    expect(createSql).toContain(`"col""with""quotes"`)

    try {
      for (const stmt of createSql.split(/;\s*\n?/).filter((s) => s.trim().length > 0)) {
        await pool.query(stmt + ';')
      }
      // Confirm the column was created with the literal name.
      const cols = await pool.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'weird_cols' ORDER BY column_name`,
      )
      expect(cols.rows.map((r) => r.column_name)).toContain('col"with"quotes')
    } finally {
      await pool.query(`DROP TABLE IF EXISTS "weird_cols" CASCADE`).catch(() => {})
    }
  }, 30_000)
})
