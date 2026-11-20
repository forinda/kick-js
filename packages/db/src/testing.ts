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
import { CODE_MIGRATION_FILES } from './migrate/code-migration'
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
  /**
   * How long a file waits for another file building the same template
   * (default 120 s). Keep your test runner's hook timeout above it.
   */
  lockWaitSeconds?: number
}

/** Waiting for the template lock took too long: say what it was waiting for. */
const lockTimedOut = (template: string, seconds: number) =>
  new Error(
    `@forinda/kickjs-db/testing: waited ${seconds}s for the lock on ${template} — another test file is ` +
      'building that template. Raise lockWaitSeconds (and your hook timeout) if your migrations take longer.',
  )

/**
 * The files a migration run reads. Others (meta.json, whose review flag flips,
 * editor and OS files) would rebuild the template for nothing. Code a
 * migration.ts imports from outside the folder isn't hashed: change the
 * migration itself, or drop the template (`kick_tpl_*`), when it changes.
 */
const MIGRATION_INPUTS = new Set([
  'up.sql',
  'down.sql',
  'snapshot.json',
  '_journal.json',
  ...CODE_MIGRATION_FILES,
])

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
    // Walked by hand: recursive readdir and Dirent.parentPath need Node 20.12+.
    const files: string[] = []
    const walk = async (rel: string): Promise<void> => {
      for (const e of await readdir(path.join(input.migrationsDir!, rel), {
        withFileTypes: true,
      })) {
        const child = rel ? `${rel}/${e.name}` : e.name
        if (e.isDirectory()) await walk(child)
        else if (e.isFile() && MIGRATION_INPUTS.has(e.name)) files.push(child)
      }
    }
    await walk('')
    for (const f of files.toSorted()) {
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
      const wait = opts.lockWaitSeconds ?? 120
      await admin.query(`SET lock_timeout = '${Math.max(1, Math.floor(wait))}s'`)
      await admin.query('select pg_advisory_lock(hashtext($1))', [template]).catch((err) => {
        if ((err as { code?: string }).code === '55P03') throw lockTimedOut(template, wait)
        throw err
      })
      await admin.query('RESET lock_timeout')
      try {
        const { rows } = await admin.query<{ note: string | null }>(
          `select shobj_description(oid, 'pg_database') as note from pg_database where datname = $1`,
          [template],
        )
        // A template is finished once its note is written — last, after the
        // migrations. One without it is what a killed build left: rebuild.
        const finished = rows[0]?.note?.startsWith('kick_tpl created ') ?? false
        if (!finished) {
          if (rows.length) await admin.query(`DROP DATABASE IF EXISTS "${template}" WITH (FORCE)`)
          await buildPgTemplate(pg, admin, template, urlOf(template), opts)
        }
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
    if (m[1] === 'kick_tpl') {
      // A template only under its lock: another file may be about to copy it.
      const { rows: got } = await admin.query<{ ok: boolean }>(
        'select pg_try_advisory_lock(hashtext($1)) as ok',
        [datname],
      )
      if (!got[0]?.ok) continue
      try {
        // Read again under the lock: another file may have rebuilt it since.
        const { rows: now2 } = await admin.query<{ note: string | null }>(
          `select shobj_description(oid, 'pg_database') as note from pg_database where datname = $1`,
          [datname],
        )
        const again = /^kick_tpl created (.+)$/.exec(now2[0]?.note ?? '')
        const stillOld = again && Date.now() - Date.parse(again[1]!) >= SWEEP_AFTER.kick_tpl
        if (stillOld) await admin.query(`DROP DATABASE IF EXISTS "${datname}"`).catch(() => {})
      } finally {
        await admin.query('select pg_advisory_unlock(hashtext($1))', [datname])
      }
      continue
    }
    // No FORCE: one still in use (another run's) fails, and is left alone.
    await admin.query(`DROP DATABASE IF EXISTS "${datname}"`).catch(() => {})
  }
}

/** A throwaway MySQL database: the same shape as {@link PgTestDb}. */
export type MysqlTestDb<S> = PgTestDb<S>

/** Where creation times live for the MySQL sweep (MySQL keeps no comment on a database). */
const MYSQL_META = 'kicktest_meta'
let mysqlSwept = false

type MysqlConnection = import('mysql2/promise').Connection

/**
 * A throwaway database on an existing MySQL server — a shared test container
 * (`kickTestServices`), a CI service, a local Docker MySQL — with the same
 * options as {@link createPgTestDb}. MySQL has no template databases, so the
 * migrations run once into one and each file's database copies its tables,
 * rows and foreign keys; a template with views, triggers or routines is
 * migrated per file instead. Needs `mysql2`.
 */
export async function createMysqlTestDb<S>(opts: ServerTestDbOptions<S>): Promise<MysqlTestDb<S>> {
  const server = opts.connectionString ?? process.env.KICK_TEST_MYSQL_URL
  if (!server) {
    throw new Error(
      '@forinda/kickjs-db/testing: createMysqlTestDb needs a connectionString (or KICK_TEST_MYSQL_URL, set by kickTestServices)',
    )
  }
  guardTestServer(server, opts.allowNonTestDatabase)
  const mysql = await import('mysql2/promise')
  const name = `kick_test_${randomBytes(6).toString('hex')}`
  const urlOf = (db: string) => {
    const url = new URL(server)
    url.pathname = `/${db}`
    return url.toString()
  }

  const admin = await mysql.createConnection({ uri: server, multipleStatements: true })
  try {
    await admin.query(`CREATE DATABASE IF NOT EXISTS \`${MYSQL_META}\``)
    await admin.query(
      `CREATE TABLE IF NOT EXISTS \`${MYSQL_META}\`.dbs (name varchar(64) PRIMARY KEY, created_at bigint NOT NULL)`,
    )
    if (!mysqlSwept) {
      mysqlSwept = true
      await sweepMysql(admin)
    }
    if (opts.migrationsDir || opts.schema) {
      const key = await templateKey({
        migrationsDir: opts.migrationsDir,
        schema: opts.schema,
        casing: opts.casing,
        dialect: 'mysql',
      })
      const template = `kick_tpl_${key}`
      const wait = opts.lockWaitSeconds ?? 120
      const [locked] = await admin.query('SELECT GET_LOCK(?, ?) AS got', [template, wait])
      // 1: ours. 0: timed out. NULL: an error. Only 1 may go on.
      if (Number((locked as Array<{ got: number | null }>)[0]?.got) !== 1) {
        throw lockTimedOut(template, wait)
      }
      try {
        // Finished once its registry row is written — last, after the
        // migrations. A schema without one is what a killed build left.
        const [done] = await admin.query(`SELECT 1 FROM \`${MYSQL_META}\`.dbs WHERE name = ?`, [
          template,
        ])
        if (!(done as unknown[]).length) {
          await admin.query(`DROP DATABASE IF EXISTS \`${template}\``)
          await buildMysql(mysql, admin, template, urlOf(template), opts, true)
        }
        if (await mysqlHasProgrammables(admin, template)) {
          // Views, triggers and routines don't copy with CREATE TABLE … LIKE.
          await buildMysql(mysql, admin, name, urlOf(name), opts, false)
        } else {
          await copyMysql(admin, template, name)
        }
      } finally {
        await admin.query('SELECT RELEASE_LOCK(?)', [template])
      }
    } else {
      await admin.query(`CREATE DATABASE \`${name}\``)
    }
    await admin.query(`INSERT INTO \`${MYSQL_META}\`.dbs VALUES (?, ?)`, [name, Date.now()])
  } finally {
    await admin.end()
  }

  const connectionString = urlOf(name)
  const { mysqlDialect } = await import('./mysql')
  const pool = mysql.createPool({ uri: connectionString })
  const db = createDbClient({
    schema: opts.schema ?? {},
    dialect: mysqlDialect({ pool }),
    casing: opts.casing,
    events: true,
  }) as never as KickDbClient<SchemaToTypes<S>>
  return {
    db,
    connectionString,
    async drop() {
      await db.destroy()
      const admin = await mysql.createConnection({ uri: server })
      try {
        await admin.query(`DROP DATABASE IF EXISTS \`${name}\``)
        await admin.query(`DELETE FROM \`${MYSQL_META}\`.dbs WHERE name = ?`, [name])
      } finally {
        await admin.end()
      }
    },
  }
}

/** Create `db` and apply the migrations (or the schema); a failed template is dropped. */
async function buildMysql<S>(
  mysql: typeof import('mysql2/promise'),
  admin: MysqlConnection,
  db: string,
  url: string,
  opts: ServerTestDbOptions<S>,
  template: boolean,
): Promise<void> {
  await admin.query(`CREATE DATABASE \`${db}\``)
  try {
    const pool = mysql.createPool({ uri: url, multipleStatements: true })
    try {
      if (opts.migrationsDir) {
        const { mysqlAdapter } = await import('./mysql')
        await migrateLatest({
          adapter: mysqlAdapter({ pool }),
          migrationsDir: opts.migrationsDir,
          requireReviewed: false,
          driftCheck: 'ignore',
        })
      } else {
        const { emitMysql } = await import('./emit/mysql')
        const empty: SchemaSnapshot = { version: 1, dialect: 'mysql', tables: {} }
        await pool.query(
          emitMysql(
            diff(
              empty,
              extractSnapshot(opts.schema as Record<string, unknown>, 'mysql', {
                casing: opts.casing,
              }),
            ),
          ),
        )
      }
    } finally {
      await pool.end()
    }
    if (template)
      await admin.query(`INSERT INTO \`${MYSQL_META}\`.dbs VALUES (?, ?)`, [db, Date.now()])
  } catch (err) {
    await admin.query(`DROP DATABASE IF EXISTS \`${db}\``).catch(() => {})
    throw err
  }
}

async function mysqlHasProgrammables(admin: MysqlConnection, db: string): Promise<boolean> {
  const [rows] = await admin.query(
    `SELECT (SELECT COUNT(*) FROM information_schema.VIEWS WHERE TABLE_SCHEMA = ?)
          + (SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ?)
          + (SELECT COUNT(*) FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ?) AS n`,
    [db, db, db],
  )
  return Number((rows as Array<{ n: number }>)[0]!.n) > 0
}

/** `to` as a copy of `from`: each table's structure and rows, then the foreign keys LIKE leaves out. */
async function copyMysql(admin: MysqlConnection, from: string, to: string): Promise<void> {
  await admin.query(`CREATE DATABASE \`${to}\``)
  try {
    await copyMysqlInto(admin, from, to)
  } catch (err) {
    // Not registered yet, so no sweep would ever find it: drop it here.
    await admin.query(`DROP DATABASE IF EXISTS \`${to}\``).catch(() => {})
    throw err
  }
}

async function copyMysqlInto(admin: MysqlConnection, from: string, to: string): Promise<void> {
  const [tables] = await admin.query(
    "SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'",
    [from],
  )
  const names = (tables as Array<{ t: string }>).map((r) => r.t)
  await admin.query('SET FOREIGN_KEY_CHECKS = 0')
  try {
    for (const t of names) {
      await admin.query(`CREATE TABLE \`${to}\`.\`${t}\` LIKE \`${from}\`.\`${t}\``)
      // Named columns: a generated one can't be written, and `SELECT *` skips
      // invisible ones (they're listed here).
      const [cols] = await admin.query(
        `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND EXTRA NOT LIKE '%GENERATED%'
          ORDER BY ORDINAL_POSITION`,
        [from, t],
      )
      const list = (cols as Array<{ c: string }>).map((r) => `\`${r.c}\``).join(', ')
      if (list) {
        await admin.query(
          `INSERT INTO \`${to}\`.\`${t}\` (${list}) SELECT ${list} FROM \`${from}\`.\`${t}\``,
        )
      }
    }
    const [fks] = await admin.query(
      `SELECT k.TABLE_NAME AS t, k.CONSTRAINT_NAME AS c, k.COLUMN_NAME AS col,
              k.REFERENCED_TABLE_NAME AS rt, k.REFERENCED_COLUMN_NAME AS rcol,
              r.DELETE_RULE AS del, r.UPDATE_RULE AS upd
         FROM information_schema.KEY_COLUMN_USAGE k
         JOIN information_schema.REFERENTIAL_CONSTRAINTS r
           ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
        WHERE k.TABLE_SCHEMA = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL
        ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION`,
      [from],
    )
    const byKey = new Map<
      string,
      {
        t: string
        c: string
        cols: string[]
        rt: string
        rcols: string[]
        del: string
        upd: string
      }
    >()
    for (const f of fks as Array<{
      t: string
      c: string
      col: string
      rt: string
      rcol: string
      del: string
      upd: string
    }>) {
      const k = `${f.t}\0${f.c}`
      const e = byKey.get(k) ?? {
        t: f.t,
        c: f.c,
        cols: [],
        rt: f.rt,
        rcols: [],
        del: f.del,
        upd: f.upd,
      }
      e.cols.push(f.col)
      e.rcols.push(f.rcol)
      byKey.set(k, e)
    }
    const q = (c: string[]) => c.map((x) => `\`${x}\``).join(', ')
    for (const f of byKey.values()) {
      await admin.query(
        `ALTER TABLE \`${to}\`.\`${f.t}\` ADD CONSTRAINT \`${f.c}\` FOREIGN KEY (${q(f.cols)})
           REFERENCES \`${to}\`.\`${f.rt}\` (${q(f.rcols)}) ON DELETE ${f.del} ON UPDATE ${f.upd}`,
      )
    }
  } finally {
    await admin.query('SET FOREIGN_KEY_CHECKS = 1')
  }
}

/** Drop old test databases and templates, once per process; skip any with a connection. */
async function sweepMysql(admin: MysqlConnection): Promise<void> {
  const [rows] = await admin.query(`SELECT name, created_at FROM \`${MYSQL_META}\`.dbs`)
  const [busy] = await admin.query(
    'SELECT DISTINCT DB AS db FROM information_schema.PROCESSLIST WHERE DB IS NOT NULL',
  )
  const inUse = new Set((busy as Array<{ db: string }>).map((r) => r.db))
  const now = Date.now()
  for (const { name, created_at } of rows as Array<{ name: string; created_at: number }>) {
    const kind = name.startsWith('kick_tpl_') ? 'kick_tpl' : 'kick_test'
    if (now - Number(created_at) < SWEEP_AFTER[kind] || inUse.has(name)) continue
    // A template only under its lock: a copy reads it over another
    // connection, which PROCESSLIST doesn't show as using it.
    if (kind === 'kick_tpl') {
      const [got] = await admin.query('SELECT GET_LOCK(?, 0) AS got', [name])
      if (Number((got as Array<{ got: number | null }>)[0]?.got) !== 1) continue
    }
    try {
      if (kind === 'kick_tpl') {
        // Read again under the lock: another file may have rebuilt it since.
        const [again] = await admin.query(
          `SELECT created_at FROM \`${MYSQL_META}\`.dbs WHERE name = ?`,
          [name],
        )
        const at = (again as Array<{ created_at: number }>)[0]?.created_at
        if (at === undefined || Date.now() - Number(at) < SWEEP_AFTER.kick_tpl) continue
      }
      await admin.query(`DROP DATABASE IF EXISTS \`${name}\``).catch(() => {})
      await admin.query(`DELETE FROM \`${MYSQL_META}\`.dbs WHERE name = ?`, [name])
    } finally {
      if (kind === 'kick_tpl') await admin.query('SELECT RELEASE_LOCK(?)', [name])
    }
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
