import { Kysely } from 'kysely'
import { splitSqlStatements } from '../../migrate/split-statements'
import { mysqlDialect } from './dialect'
import {
  KickDbError,
  lockTableDdl,
  lockTableName,
  quoteTable,
  KICK_MIGRATIONS_TABLE,
  migrationsTableDdl,
  type Dialect,
  type MigrationAdapter,
  type MigrationBookkeeping,
  type MigrationRow,
  type SchemaSnapshot,
} from '../../index'
import { introspectMysql } from '../../migrate/introspect-mysql'

/**
 * mysql2-shaped pool that `mysqlAdapter` consumes. Mirrors the
 * structural surface of `mysql2/promise`'s Pool. The adapter only
 * uses `query(...)` and `getConnection(...)` so any mysql2-compatible
 * driver works.
 *
 * Return type is `Promise<[R, unknown]>` (not `[R[], unknown]`) so
 * mysql2's `Pool.query()` is structurally assignable: SELECT
 * statements return `RowDataPacket[]` (so callers pass `R =
 * MyRow[]`), INSERT / UPDATE / DELETE return `ResultSetHeader` (so
 * callers pass `R = ResultSetHeader`). Each adapter call site picks
 * the row shape it expects via the type parameter.
 */
export interface MysqlConnectionLike {
  // `any[]`, not `readonly unknown[]`: mysql2 declares its values parameter
  // mutable, and a readonly one here made a real mysql2 Pool unassignable.
  // oxlint-disable-next-line no-explicit-any
  query<R = unknown>(sql: string, params?: any[]): Promise<[R, unknown]>
  release(): void
}

export interface MysqlPoolLike {
  // oxlint-disable-next-line no-explicit-any
  query<R = unknown>(sql: string, params?: any[]): Promise<[R, unknown]>
  getConnection(): Promise<MysqlConnectionLike>
  end?(): Promise<void>
}

export interface MysqlAdapterOptions {
  /**
   * The table migrations are recorded in. Default `kick_migrations`; its lock
   * table is the same name plus `_lock`.
   */
  migrationsTable?: string
  /**
   * mysql2-compatible Pool. Caller-owned — `close()` on the adapter
   * does NOT end the pool because adopters typically share a single
   * pool across the migration adapter and the KickDbClient.
   */
  pool: MysqlPoolLike
  /**
   * End the pool when the adapter closes. Set it when the adapter owns its
   * pool — a `kick.config.ts` `db.adapter()` factory that opens one for the
   * CLI — or the `kick db` command never exits. Default `false`: an app
   * usually shares one pool with its client.
   */
  endPoolOnClose?: boolean
}

/**
 * Minimum supported MySQL major + MariaDB version. `JSON_ARRAYAGG`
 * shipped in MySQL 8.0 and MariaDB 10.5 — earlier versions can't
 * run kickjs-db's relational query layer.
 */
const MIN_MYSQL_MAJOR = 8
const MIN_MARIADB_MAJOR = 10
const MIN_MARIADB_MINOR = 5

/**
 * Parsed shape returned by `parseMysqlVersion`. `flavor` lets
 * adopters distinguish MySQL from MariaDB without re-grepping the
 * raw string.
 */
export interface ParsedMysqlVersion {
  flavor: 'mysql' | 'mariadb'
  major: number
  minor: number
}

/**
 * Parse a MySQL `SELECT VERSION()` string. Handles:
 *
 *   - MySQL: `8.0.34`, `8.4.0`, `5.7.42-log`
 *   - MariaDB plain: `10.6.11-MariaDB`, `10.5.21-MariaDB-log`,
 *                    `10.4.32-MariaDB`
 *   - MariaDB w/ compat prefix: `5.5.5-10.6.11-MariaDB-1:10.6.11+maria~ubu2004`
 *     (the leading `5.5.5-` is a wire-protocol thing for older MySQL
 *     clients; the real server version sits immediately before
 *     `-MariaDB`)
 *
 * Returns `null` on unparseable input.
 */
export function parseMysqlVersion(version: string): ParsedMysqlVersion | null {
  const trimmed = version.trim()
  const isMariaDb = /MariaDB/i.test(trimmed)

  if (isMariaDb) {
    // Pull the `major.minor` that sits immediately before
    // `-MariaDB`. This skips the `5.5.5-` compat prefix when
    // present and grabs the real server version regardless of
    // whether one's there.
    const m = /(\d+)\.(\d+)(?:\.\d+)?-MariaDB/i.exec(trimmed)
    if (m) {
      const major = Number(m[1])
      const minor = Number(m[2])
      if (Number.isFinite(major) && Number.isFinite(minor)) {
        return { flavor: 'mariadb', major, minor }
      }
    }
    // Fallback for vendor strings we haven't seen — try the
    // leading x.y. Better to surface the wrong floor than to
    // refuse an otherwise valid MariaDB outright.
    const fallback = /^(\d+)\.(\d+)/.exec(trimmed)
    if (!fallback) return null
    const major = Number(fallback[1])
    const minor = Number(fallback[2])
    if (!Number.isFinite(major) || !Number.isFinite(minor)) return null
    return { flavor: 'mariadb', major, minor }
  }

  // MySQL: leading x.y from the start of the string.
  const m = /^(\d+)\.(\d+)/.exec(trimmed)
  if (!m) return null
  const major = Number(m[1])
  const minor = Number(m[2])
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return null
  return { flavor: 'mysql', major, minor }
}

/**
 * Back-compat shim — pre-existing API surface that returned the
 * major version only. Kept exported so adopters depending on it
 * keep working; new code should use `parseMysqlVersion`.
 *
 * @deprecated Use `parseMysqlVersion` for full version + flavor info.
 */
export function parseMysqlMajorVersion(version: string): number | null {
  const parsed = parseMysqlVersion(version)
  return parsed?.major ?? null
}

/**
 * Returns the failure reason if the parsed version doesn't satisfy
 * kickjs-db's floor, or `null` if it does. Pure — no I/O.
 */
function checkVersionSupport(parsed: ParsedMysqlVersion | null, raw: string): string | null {
  if (parsed == null) {
    return `unparseable version string: ${raw || '<empty>'}`
  }
  if (parsed.flavor === 'mariadb') {
    if (parsed.major > MIN_MARIADB_MAJOR) return null
    if (parsed.major < MIN_MARIADB_MAJOR) {
      return `MariaDB ${MIN_MARIADB_MAJOR}.${MIN_MARIADB_MINOR}+ required (detected: ${raw})`
    }
    if (parsed.minor < MIN_MARIADB_MINOR) {
      return `MariaDB ${MIN_MARIADB_MAJOR}.${MIN_MARIADB_MINOR}+ required (detected: ${raw})`
    }
    return null
  }
  // MySQL flavor.
  if (parsed.major < MIN_MYSQL_MAJOR) {
    return `MySQL ${MIN_MYSQL_MAJOR}.0+ required (detected: ${raw})`
  }
  return null
}

/** {@link splitSqlStatements} for MySQL. */
export function splitMysqlStatements(sql: string): string[] {
  return splitSqlStatements(sql, 'mysql')
}

/**
 * MigrationAdapter implementation backed by mysql2.
 *
 * Asserts MySQL 8.0+ (or MariaDB 10.5+) on first connection (via
 * the first `ensureMigrationTables` call, lazily — no I/O at
 * construction time). Earlier versions throw `KickDbError` with
 * code `KICK_DB_RELATIONAL_NOT_SUPPORTED` carrying the detected
 * version so adopters get a clear error before any query reaches
 * the relational compiler.
 *
 * Multi-statement support: every `query()` call splits the SQL
 * blob at top-level semicolons and runs each statement
 * sequentially. Works against mysql2's default settings; adopters
 * who set `multipleStatements: true` on the pool pay no extra
 * cost (the split is cheap on small DDL blobs).
 *
 * Lock semantics: single-row UPDATE WHERE locked_at IS NULL on
 * `kick_migrations_lock`. Only the row created by
 * `ensureMigrationTables()` exists, so the UPDATE either flips
 * `locked_at` and returns `affectedRows=1` (we won) or matches
 * zero rows (someone else holds it).
 *
 * Introspection: not implemented in v1 — throws `KickDbError` with
 * code `KICK_DB_INTROSPECT_NOT_SUPPORTED`. Drift detection lands
 * in a follow-up that walks `information_schema`.
 */
export function mysqlAdapter(opts: MysqlAdapterOptions): MigrationAdapter {
  if (opts.endPoolOnClose && typeof opts.pool.end !== 'function') {
    throw new KickDbError(
      'KICK_DB_POOL_NOT_CLOSABLE',
      'mysqlAdapter({ endPoolOnClose: true }) needs a pool with an end() method to close',
    )
  }
  const dialect: Dialect = 'mysql'
  const { pool } = opts
  let versionVerified = false

  async function assertVersion() {
    if (versionVerified) return
    const [rows] = await pool.query<{ version: string }[]>(`SELECT VERSION() AS \`version\``)
    const versionString = rows[0]?.version ?? ''
    const parsed = parseMysqlVersion(versionString)
    const failure = checkVersionSupport(parsed, versionString)
    if (failure) {
      throw new KickDbError(
        'KICK_DB_RELATIONAL_NOT_SUPPORTED',
        `${failure}. JSON_ARRAYAGG (required by the relational query layer) shipped in ` +
          `MySQL 8.0 and MariaDB 10.5. Use layer-1/layer-2 queries (selectFrom / selectAll) ` +
          `on older versions.`,
      )
    }
    versionVerified = true
  }

  /**
   * Run a (possibly multi-statement) SQL blob via the pool,
   * splitting at top-level `;` so default mysql2 settings work.
   */
  async function runStatements(sql: string): Promise<void> {
    for (const stmt of splitMysqlStatements(sql)) {
      await pool.query(stmt)
    }
  }

  /**
   * Same as `runStatements` but on a held connection (used inside
   * `applySqlInTx` so all statements share the BEGIN / COMMIT
   * boundary).
   */
  async function runStatementsOnConn(conn: MysqlConnectionLike, sql: string): Promise<void> {
    for (const stmt of splitMysqlStatements(sql)) {
      await conn.query(stmt)
    }
  }

  const table = opts.migrationsTable ?? KICK_MIGRATIONS_TABLE
  const T = quoteTable(dialect, table)
  const L = quoteTable(dialect, lockTableName(table))
  // Introspection must not report the bookkeeping tables as schema.
  // A dot is part of the name here, not a schema.
  const bookkeepingTables = [table, lockTableName(table)]
  let migrationDb: Kysely<any> | undefined
  return {
    dialect,

    async ensureMigrationTables() {
      await assertVersion()
      await runStatements(migrationsTableDdl(dialect, table))
      await runStatements(lockTableDdl(dialect, table))
    },

    async listApplied(): Promise<MigrationRow[]> {
      const [rows] = await pool.query<
        Array<{
          id: string
          name: string
          hash: string
          batch: number
          applied_at: string | Date
          direction: 'up' | 'down'
        }>
      >(
        `SELECT id, name, hash, batch, applied_at, direction
         FROM ${T}
         ORDER BY applied_at ASC, id ASC`,
      )
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        hash: row.hash,
        batch: Number(row.batch),
        appliedAt:
          row.applied_at instanceof Date ? row.applied_at.toISOString() : String(row.applied_at),
        direction: row.direction,
      }))
    },

    async recordApplied(row) {
      await pool.query(
        `INSERT INTO ${T} (id, name, hash, batch, direction)
         VALUES (?, ?, ?, ?, ?)`,
        [row.id, row.name, row.hash, row.batch, row.direction],
      )
    },

    async removeApplied(id: string) {
      await pool.query(`DELETE FROM ${T} WHERE id = ?`, [id])
    },

    async acquireLock(owner: string): Promise<boolean> {
      const [result] = await pool.query<{ affectedRows: number }>(
        `UPDATE ${L}
         SET locked_at = CURRENT_TIMESTAMP, locked_by = ?
         WHERE id = 1 AND locked_at IS NULL`,
        [owner],
      )
      return result.affectedRows === 1
    },

    async releaseLock() {
      await pool.query(
        `UPDATE ${L}
         SET locked_at = NULL, locked_by = NULL
         WHERE id = 1`,
      )
    },

    async applySqlInTx(sql: string) {
      await this.applyMigrationInTx!(sql, null)
    },

    // MySQL commits DDL as it runs (an implicit COMMIT that ends this
    // transaction), so for a migration with DDL this is not atomic: the
    // schema change is committed before the bookkeeping row is written, and a
    // crash in between leaves it applied but unrecorded. Only a migration of
    // plain DML statements commits with its row.
    async applyMigrationInTx(sql: string, bookkeeping: MigrationBookkeeping | null) {
      const conn = await pool.getConnection()
      try {
        await conn.query('START TRANSACTION')
        await runStatementsOnConn(conn, sql)
        if (bookkeeping && 'record' in bookkeeping) {
          const r = bookkeeping.record
          await conn.query(
            `INSERT INTO ${T} (id, name, hash, batch, direction)
             VALUES (?, ?, ?, ?, ?)`,
            [r.id, r.name, r.hash, r.batch, r.direction],
          )
        } else if (bookkeeping) {
          await conn.query(`DELETE FROM ${T} WHERE id = ?`, [bookkeeping.remove])
        }
        await conn.query('COMMIT')
      } catch (err) {
        await conn.query('ROLLBACK').catch(() => {
          // Swallow rollback errors; we're already throwing the original.
        })
        throw err
      } finally {
        conn.release()
      }
    },

    async applySqlNoTx(sql: string) {
      await runStatements(sql)
    },

    async introspect(): Promise<SchemaSnapshot> {
      // Reverse-engineer the live schema via information_schema. Types come
      // back as the declared COLUMN_TYPE (a code-first `uuid()` reads as
      // `char(36)`), so this powers `kick db introspect`; byte-exact drift
      // against a code-first snapshot needs a dialect-normalised compare.
      return introspectMysql(pool, { excludeTables: bookkeepingTables })
    },

    migrationsTable: table,

    kysely() {
      // Built once, on the same connection. Never destroyed here: the pool or
      // handle belongs to the caller (or to close()).
      return (migrationDb ??= new Kysely<any>({
        dialect: mysqlDialect({ pool: opts.pool as never }),
      }))
    },

    async close() {
      // The caller owns the pool unless it said otherwise — adopters
      // typically share it with the KickDbClient.
      if (opts.endPoolOnClose) await pool.end?.()
    },
  }
}
