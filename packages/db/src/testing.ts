// `@forinda/kickjs-db/testing` — test helpers (D.15): a throwaway database
// per test file, and a transaction per test that never commits.
import { randomBytes } from 'node:crypto'
import { createDbClient } from './client/create'
import type { KickDbClient } from './client/types'
import type { SchemaToTypes } from './client/schema-types'
import { diff } from './diff/engine'
import { emitPg } from './emit/pg'
import { emitSqlite } from './emit/sqlite'
import { migrateLatest } from './migrate/runner'
import { extractSnapshot } from './snapshot/extract'
import type { SchemaSnapshot } from './snapshot/types'

export interface TestDbOptions<S> {
  schema: S
  /**
   * Apply these migrations instead of creating tables straight from the
   * schema — the SQL production runs. Unreviewed ones apply too.
   */
  migrationsDir?: string
  /** The `casing` your client and `kick.config.ts` use. */
  casing?: 'snake_case'
}

/**
 * A fresh in-memory SQLite database with your schema, foreign keys on —
 * milliseconds to create, one per test file. Needs `better-sqlite3`.
 *
 *   const db = await createTestDb({ schema })
 */
export async function createTestDb<S>(
  opts: TestDbOptions<S>,
): Promise<KickDbClient<SchemaToTypes<S>>> {
  const { default: Database } = await import('better-sqlite3')
  const { sqliteAdapter, sqliteDialect } = await import('./sqlite')
  const database = new Database(':memory:')
  database.pragma('foreign_keys = ON')

  if (opts.migrationsDir) {
    await migrateLatest({
      adapter: sqliteAdapter({ database }),
      migrationsDir: opts.migrationsDir,
      requireReviewed: false,
      driftCheck: 'ignore',
    })
  } else {
    const empty: SchemaSnapshot = { version: 1, dialect: 'sqlite', tables: {} }
    const target = extractSnapshot(opts.schema as Record<string, unknown>, 'sqlite', {
      casing: opts.casing,
    })
    database.exec(emitSqlite(diff(empty, target), { from: empty, to: target }))
  }
  return createDbClient({
    schema: opts.schema,
    dialect: sqliteDialect({ database }),
    casing: opts.casing,
  }) as never
}

export interface PgTestDb<S> {
  db: KickDbClient<SchemaToTypes<S>>
  /** The throwaway database's connection string — for code that opens its own pool. */
  connectionString: string
  /** Close the client and drop the database. Call it in `afterAll`. */
  drop(): Promise<void>
}

/**
 * A throwaway database on an existing Postgres server — a CI service
 * container, a local Docker Postgres — with your schema or migrations
 * applied. Creating one takes well under a second, so each test file can
 * have its own without starting a container. Needs `pg`.
 *
 *   const pg = await createPgTestDb({ schema, connectionString: process.env.TEST_DATABASE_URL! })
 *   afterAll(() => pg.drop())
 */
export async function createPgTestDb<S>(
  opts: TestDbOptions<S> & {
    /** A database on the server to connect to first, with permission to CREATE DATABASE. */
    connectionString: string
  },
): Promise<PgTestDb<S>> {
  const { default: pg } = await import('pg')
  const { pgAdapter, pgDialect } = await import('./pg')
  const name = `kick_test_${randomBytes(6).toString('hex')}`

  const admin = new pg.Client({ connectionString: opts.connectionString })
  await admin.connect()
  try {
    await admin.query(`CREATE DATABASE "${name}"`)
  } finally {
    await admin.end()
  }

  const url = new URL(opts.connectionString)
  url.pathname = `/${name}`
  const connectionString = url.toString()
  const pool = new pg.Pool({ connectionString })
  pool.on('error', () => {}) // dropped connections at teardown aren't test failures

  if (opts.migrationsDir) {
    await migrateLatest({
      adapter: pgAdapter({ pool }),
      migrationsDir: opts.migrationsDir,
      requireReviewed: false,
      driftCheck: 'ignore',
    })
  } else {
    const empty: SchemaSnapshot = { version: 1, dialect: 'postgres', tables: {} }
    await pool.query(
      emitPg(
        diff(
          empty,
          extractSnapshot(opts.schema as Record<string, unknown>, 'postgres', {
            casing: opts.casing,
          }),
        ),
      ),
    )
  }

  const db = createDbClient({
    schema: opts.schema,
    dialect: pgDialect({ pool }),
    casing: opts.casing,
  }) as never as KickDbClient<SchemaToTypes<S>>
  return {
    db,
    connectionString,
    async drop() {
      await db.destroy() // ends the pool
      const admin = new pg.Client({ connectionString: opts.connectionString })
      await admin.connect()
      try {
        await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
      } finally {
        await admin.end()
      }
    },
  }
}

const ROLLBACK = Symbol('kickjs-db rolled back')

/**
 * Run `fn` in a transaction that's always rolled back — every test starts
 * from the same data. Code that only holds the client (a service, a
 * repository) joins the transaction through the call chain, so nothing it
 * writes survives. `afterCommit` hooks don't run. A real failure in `fn`
 * still throws.
 *
 *   it('creates a user', () => rolledBack(db, async () => { … }))
 */
export async function rolledBack<T>(
  // oxlint-disable-next-line no-explicit-any -- any schema's client
  db: Pick<KickDbClient<any>, 'transaction'>,
  fn: () => Promise<T>,
): Promise<T> {
  let result!: T
  await db
    .transaction(async () => {
      result = await fn()
      throw ROLLBACK
    })
    .catch((err: unknown) => {
      if (err !== ROLLBACK) throw err
    })
  return result
}
