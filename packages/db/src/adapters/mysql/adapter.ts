import {
  KickDbError,
  lockTableDdl,
  migrationsTableDdl,
  type Dialect,
  type MigrationAdapter,
  type MigrationRow,
  type SchemaSnapshot,
} from '../../index'

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
  query<R = unknown>(sql: string, params?: readonly unknown[]): Promise<[R, unknown]>
  release(): void
}

export interface MysqlPoolLike {
  query<R = unknown>(sql: string, params?: readonly unknown[]): Promise<[R, unknown]>
  getConnection(): Promise<MysqlConnectionLike>
}

export interface MysqlAdapterOptions {
  /**
   * mysql2-compatible Pool. Caller-owned — `close()` on the adapter
   * does NOT end the pool because adopters typically share a single
   * pool across the migration adapter and the KickDbClient.
   */
  pool: MysqlPoolLike
}

/**
 * Minimum supported MySQL major + MariaDB version. `JSON_ARRAYAGG`
 * shipped in MySQL 8.0 and MariaDB 10.5 — earlier versions can't
 * run kickjs-db's relational query layer.
 *
 * Spec: docs/db/spec-relational-query-other-dialects.md §7 R-1.
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

/**
 * Split a SQL blob into individual statements at the top-level `;`
 * boundary. Respects single-quote / double-quote / backtick string
 * literals AND `--` line comments + C-style block comments —
 * `;` inside any of those does not terminate a statement.
 *
 * mysql2's default `Pool.query()` rejects multi-statement SQL unless
 * the driver was created with `multipleStatements: true`. Splitting
 * lets the adapter run kickjs-emitted DDL (multi-statement, but
 * always semicolon-separated at the top level) without that flag.
 *
 * Two MySQL-specific quirks the splitter handles:
 *
 *   - **`--` comments require trailing whitespace/end-of-input.**
 *     Per MySQL docs, `--` is only a line-comment introducer when
 *     followed by whitespace (space/tab/newline) or end-of-input —
 *     otherwise it's two unary-minus operators (`5--3` evaluates
 *     to `8`). Bare `--xyz` is a parse error in MySQL but kickjs
 *     should pass it through unchanged so the driver surfaces the
 *     real error, not silently swallow the rest of the line.
 *   - **Doubled-quote string escapes.** MySQL accepts both
 *     backslash-escapes (`'it\'s'`) and SQL-standard doubled-quote
 *     escapes (`'it''s'`). The state machine peeks for the doubled
 *     form and stays in-string. Same rule applies to `""` inside
 *     double-quoted strings.
 *
 * Adopter-written migrations with pathological SQL — e.g. `;` in
 * an unterminated block comment — won't split correctly.
 * Documented in the README; turn on `multipleStatements: true` on
 * the pool if you hit it.
 */
export function splitMysqlStatements(sql: string): string[] {
  const out: string[] = []
  let buf = ''
  let inSingle = false
  let inDouble = false
  let inBacktick = false
  let inLineComment = false
  let inBlockComment = false

  const isCommentWhitespace = (c: string) =>
    c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v'

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]
    const next = i + 1 < sql.length ? sql[i + 1] : ''
    const after = i + 2 < sql.length ? sql[i + 2] : ''

    if (inLineComment) {
      buf += ch
      if (ch === '\n') inLineComment = false
      continue
    }
    if (inBlockComment) {
      buf += ch
      if (ch === '*' && next === '/') {
        buf += next
        i++
        inBlockComment = false
      }
      continue
    }
    if (inSingle) {
      // Doubled `''` is an SQL-standard escape — stay in-string.
      if (ch === "'" && next === "'") {
        buf += ch
        buf += next
        i++
        continue
      }
      buf += ch
      if (ch === '\\' && next !== '') {
        buf += next
        i++
        continue
      }
      if (ch === "'") inSingle = false
      continue
    }
    if (inDouble) {
      // Doubled `""` is an SQL-standard escape — stay in-string.
      if (ch === '"' && next === '"') {
        buf += ch
        buf += next
        i++
        continue
      }
      buf += ch
      if (ch === '\\' && next !== '') {
        buf += next
        i++
        continue
      }
      if (ch === '"') inDouble = false
      continue
    }
    if (inBacktick) {
      buf += ch
      if (ch === '`') inBacktick = false
      continue
    }

    // `--` is a comment introducer only when followed by whitespace
    // (or end-of-input). Anything else (`5--3`, `--xyz`) is left as
    // operator-soup and the driver decides what to do with it.
    if (ch === '-' && next === '-' && (after === '' || isCommentWhitespace(after))) {
      buf += ch
      inLineComment = true
      continue
    }
    if (ch === '/' && next === '*') {
      buf += ch
      inBlockComment = true
      continue
    }
    if (ch === "'") {
      buf += ch
      inSingle = true
      continue
    }
    if (ch === '"') {
      buf += ch
      inDouble = true
      continue
    }
    if (ch === '`') {
      buf += ch
      inBacktick = true
      continue
    }
    if (ch === ';') {
      const trimmed = buf.trim()
      if (trimmed.length > 0) out.push(trimmed)
      buf = ''
      continue
    }
    buf += ch
  }

  const tail = buf.trim()
  if (tail.length > 0) out.push(tail)
  return out
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

  return {
    dialect,

    async ensureMigrationTables() {
      await assertVersion()
      await runStatements(migrationsTableDdl(dialect))
      await runStatements(lockTableDdl(dialect))
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
         FROM \`kick_migrations\`
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
        `INSERT INTO \`kick_migrations\` (id, name, hash, batch, direction)
         VALUES (?, ?, ?, ?, ?)`,
        [row.id, row.name, row.hash, row.batch, row.direction],
      )
    },

    async removeApplied(id: string) {
      await pool.query(`DELETE FROM \`kick_migrations\` WHERE id = ?`, [id])
    },

    async acquireLock(owner: string): Promise<boolean> {
      const [result] = await pool.query<{ affectedRows: number }>(
        `UPDATE \`kick_migrations_lock\`
         SET locked_at = CURRENT_TIMESTAMP, locked_by = ?
         WHERE id = 1 AND locked_at IS NULL`,
        [owner],
      )
      return result.affectedRows === 1
    },

    async releaseLock() {
      await pool.query(
        `UPDATE \`kick_migrations_lock\`
         SET locked_at = NULL, locked_by = NULL
         WHERE id = 1`,
      )
    },

    async applySqlInTx(sql: string) {
      const conn = await pool.getConnection()
      try {
        await conn.query('START TRANSACTION')
        await runStatementsOnConn(conn, sql)
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
      throw new KickDbError(
        'KICK_DB_INTROSPECT_NOT_SUPPORTED',
        'MySQL introspection is not supported in v1. ' +
          'Drift detection requires an information_schema walk that lands in a follow-up. ' +
          'Set `driftCheck: "off"` on the migration runner until then.',
      )
    },

    async close() {
      // Caller owns the pool. The adapter doesn't end() it —
      // adopters typically share the same pool with the
      // KickDbClient.
    },
  }
}
