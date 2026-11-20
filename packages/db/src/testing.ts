// `@forinda/kickjs-db/testing` — test helpers (D.15): a throwaway database
// per test file, and a transaction per test that never commits.
import { randomBytes } from 'node:crypto'
import { createDbClient } from './client/create'
import { EVENTS_ENABLED } from './client/events'
import type { QueryEvent } from './client/types'
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
    // On, so captureQueries / expectQueries can count.
    events: true,
  }) as never
}

export interface PgTestDb<S> {
  db: KickDbClient<SchemaToTypes<S>>
  /** The throwaway database's connection string — for code that opens its own pool. */
  connectionString: string
  /** Close the client and drop the database. Call it in `afterAll`. */
  drop(): Promise<void>
}

/** Options for a throwaway database on a shared server (Postgres or MySQL). */
export interface ServerTestDbOptions<S> extends Partial<TestDbOptions<S>> {
  /**
   * A database on the server to connect to first, with permission to CREATE
   * DATABASE. Default: `KICK_TEST_POSTGRES_URL` / `KICK_TEST_MYSQL_URL`, which
   * `kickTestServices` sets.
   */
  connectionString?: string
  /** Allow a server URL whose database name doesn't contain `test`. */
  allowNonTestDatabase?: boolean
}

/**
 * A short key for what a template holds: the migrations' files, or the
 * schema's snapshot when there are none — so a change makes a new template.
 */
export async function templateKey(input: {
  migrationsDir?: string
  schema?: unknown
  casing?: string
  dialect?: 'postgres' | 'mysql'
}): Promise<string> {
  const { createHash } = await import('node:crypto')
  const h = createHash('sha256').update(`${input.dialect ?? 'postgres'}\0${input.casing ?? ''}\0`)
  if (input.migrationsDir) {
    const { readdir, readFile } = await import('node:fs/promises')
    const path = await import('node:path')
    const files = (await readdir(input.migrationsDir, { recursive: true, withFileTypes: true }))
      .filter((e) => e.isFile())
      .map((e) => path.relative(input.migrationsDir!, path.join(e.parentPath, e.name)))
      .toSorted()
    for (const f of files) {
      h.update(f)
        .update('\0')
        .update(await readFile(path.join(input.migrationsDir, f)))
    }
  } else {
    h.update(
      JSON.stringify(
        extractSnapshot(input.schema as Record<string, unknown>, input.dialect ?? 'postgres', {
          casing: input.casing as 'snake_case' | undefined,
        }),
      ),
    )
  }
  return h.digest('hex').slice(0, 12)
}

/** Refuse a server whose database name doesn't say it's for tests. */
function guardTestServer(url: string, allow: boolean | undefined): void {
  const name = decodeURIComponent(new URL(url).pathname.slice(1))
  if (allow || /test/i.test(name)) return
  throw new Error(
    `@forinda/kickjs-db/testing: refusing to create test databases from "${name}": its name must contain "test" ` +
      '(pass allowNonTestDatabase: true to override)',
  )
}

/** When a test database was made, written on it so a later run can sweep leftovers. */
const createdNote = (kind: 'kick_test' | 'kick_tpl') =>
  `${kind} created ${new Date().toISOString()}`
const SWEEP_AFTER = { kick_test: 6 * 3_600_000, kick_tpl: 24 * 3_600_000 }

let pgSwept = false

/**
 * A throwaway database on an existing Postgres server — a shared test
 * container (`kickTestServices`), a CI service container, a local Docker
 * Postgres. With `migrationsDir` (or `schema`) it's a copy of a template
 * database migrated once, so creating one stays well under a second however
 * many migrations there are; with neither, it's empty. Needs `pg`.
 *
 *   const pg = await createPgTestDb({ migrationsDir: 'db/migrations' })
 *   afterAll(() => pg.drop())
 */
export async function createPgTestDb<S>(opts: ServerTestDbOptions<S>): Promise<PgTestDb<S>> {
  const server = opts.connectionString ?? process.env.KICK_TEST_POSTGRES_URL
  if (!server) {
    throw new Error(
      '@forinda/kickjs-db/testing: createPgTestDb needs a connectionString (or KICK_TEST_POSTGRES_URL, set by kickTestServices)',
    )
  }
  guardTestServer(server, opts.allowNonTestDatabase)
  const { default: pg } = await import('pg')
  const name = `kick_test_${randomBytes(6).toString('hex')}`
  const urlOf = (db: string) => {
    const url = new URL(server)
    url.pathname = `/${db}`
    return url.toString()
  }

  const admin = new pg.Client({ connectionString: server })
  await admin.connect()
  try {
    if (!pgSwept) {
      pgSwept = true
      await sweepPg(admin)
    }
    if (opts.migrationsDir || opts.schema) {
      const key = await templateKey({
        migrationsDir: opts.migrationsDir,
        schema: opts.schema,
        casing: opts.casing,
      })
      const template = `kick_tpl_${key}`
      // One process builds a template; the rest wait for it, then copy.
      // Copies wait too: Postgres won't copy a database someone is in.
      await admin.query('select pg_advisory_lock(hashtext($1))', [template])
      try {
        const { rowCount } = await admin.query('select 1 from pg_database where datname = $1', [
          template,
        ])
        if (!rowCount) await buildPgTemplate(pg, admin, template, urlOf(template), opts)
        await admin.query(`CREATE DATABASE "${name}" TEMPLATE "${template}"`)
      } finally {
        await admin.query('select pg_advisory_unlock(hashtext($1))', [template])
      }
    } else {
      await admin.query(`CREATE DATABASE "${name}"`)
    }
    await admin.query(`COMMENT ON DATABASE "${name}" IS '${createdNote('kick_test')}'`)
  } finally {
    await admin.end()
  }

  const connectionString = urlOf(name)
  const { pgDialect } = await import('./pg')
  const pool = new pg.Pool({ connectionString })
  // Dropped connections at teardown aren't test failures. The client-level
  // listener matters: `pool.end()` resolves before a client's socket closes,
  // and the pool detaches its own listener first, so the FORCE drop's
  // termination would otherwise surface as an uncaught error.
  pool.on('error', () => {})
  pool.on('connect', (client) => client.on('error', () => {}))

  const db = createDbClient({
    schema: opts.schema ?? {},
    dialect: pgDialect({ pool }),
    casing: opts.casing,
    events: true,
  }) as never as KickDbClient<SchemaToTypes<S>>
  return {
    db,
    connectionString,
    async drop() {
      await db.destroy() // ends the pool
      const admin = new pg.Client({ connectionString: server })
      await admin.connect()
      try {
        await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
      } finally {
        await admin.end()
      }
    },
  }
}

type PgModule = typeof import('pg').default

/** Create `template` and apply the migrations (or the schema) to it. */
async function buildPgTemplate<S>(
  pg: PgModule,
  admin: import('pg').Client,
  template: string,
  url: string,
  opts: ServerTestDbOptions<S>,
): Promise<void> {
  await admin.query(`CREATE DATABASE "${template}"`)
  try {
    const pool = new pg.Pool({ connectionString: url })
    pool.on('error', () => {})
    try {
      if (opts.migrationsDir) {
        const { pgAdapter } = await import('./pg')
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
    } finally {
      await pool.end()
    }
    await admin.query(`COMMENT ON DATABASE "${template}" IS '${createdNote('kick_tpl')}'`)
  } catch (err) {
    // A half-built template must not be copied by the next file.
    await admin.query(`DROP DATABASE IF EXISTS "${template}" WITH (FORCE)`).catch(() => {})
    throw err
  }
}

/** Drop test databases and templates a crashed run left, once per process; ones in use are skipped. */
async function sweepPg(admin: import('pg').Client): Promise<void> {
  const { rows } = await admin.query<{ datname: string; note: string | null }>(
    `select d.datname, shobj_description(d.oid, 'pg_database') as note
       from pg_database d where d.datname like 'kick\\_test\\_%' or d.datname like 'kick\\_tpl\\_%'`,
  )
  const now = Date.now()
  for (const { datname, note } of rows) {
    const m = /^(kick_test|kick_tpl) created (.+)$/.exec(note ?? '')
    if (!m) continue
    const at = Date.parse(m[2]!)
    if (Number.isNaN(at) || now - at < SWEEP_AFTER[m[1] as 'kick_test' | 'kick_tpl']) continue
    // No FORCE: one still in use (another run's) fails, and is left alone.
    await admin.query(`DROP DATABASE IF EXISTS "${datname}"`).catch(() => {})
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

// oxlint-disable-next-line no-explicit-any -- any schema's client
type Observable = Pick<KickDbClient<any>, 'on' | 'off'>

/**
 * Run `fn` and return the queries it sent, in order. The client must have
 * events on — `createTestDb` / `createPgTestDb` clients do; your own needs
 * `createDbClient({ events: true })`.
 *
 *   const { result, queries } = await captureQueries(db, () => repo.list())
 */
export async function captureQueries<T>(
  db: Observable,
  fn: () => Promise<T>,
): Promise<{ result: T; queries: QueryEvent[] }> {
  if ((db as unknown as Record<symbol, unknown>)[EVENTS_ENABLED] === false) {
    throw new Error(
      'captureQueries: this client was created without events, so no query is reported ' +
        'and every count would be 0. Create it with `events: true`.',
    )
  }
  const queries: QueryEvent[] = []
  const listener = (event: QueryEvent) => void queries.push(event)
  db.on('query', listener)
  try {
    return { result: await fn(), queries }
  } finally {
    db.off('query', listener)
  }
}

/**
 * Assert `fn` sends exactly `count` queries — a guard against N+1 queries
 * that grows with the data. On a mismatch the error lists every query sent.
 *
 *   await expectQueries(db, 2, () => postsWithAuthors()) // 1 + 1, not 1 + N
 */
export async function expectQueries<T>(
  db: Observable,
  count: number,
  fn: () => Promise<T>,
): Promise<T> {
  const { result, queries } = await captureQueries(db, fn)
  if (queries.length !== count) {
    const list = queries.map((q, i) => `  ${i + 1}. ${q.sql}`).join('\n')
    throw new Error(
      `Expected ${count} quer${count === 1 ? 'y' : 'ies'}, ran ${queries.length}:\n${list || '  (none)'}`,
    )
  }
  return result
}
