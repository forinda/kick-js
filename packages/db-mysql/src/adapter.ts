import {
  KickDbError,
  lockTableDdl,
  migrationsTableDdl,
  type Dialect,
  type MigrationAdapter,
  type MigrationRow,
  type SchemaSnapshot,
} from '@forinda/kickjs-db'

/**
 * mysql2-shaped pool that `mysqlAdapter` consumes. Mirrors the
 * structural surface of `mysql2/promise`'s Pool. The adapter only
 * uses `query(...)` and `getConnection(...)` so any mysql2-compatible
 * driver works.
 */
export interface MysqlConnectionLike {
  query<R = unknown>(sql: string, params?: readonly unknown[]): Promise<[R[], unknown]>
  release(): void
}

export interface MysqlPoolLike {
  query<R = unknown>(sql: string, params?: readonly unknown[]): Promise<[R[], unknown]>
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
 * Minimum supported MySQL major version. JSON_ARRAYAGG shipped in
 * 8.0; earlier versions can't run kickjs-db's relational query layer.
 * Spec: docs/db/spec-relational-query-other-dialects.md §7 R-1.
 */
const MIN_MYSQL_MAJOR = 8

/**
 * Parse a MySQL version string into a major version number. MySQL's
 * `SELECT VERSION()` returns shapes like `8.0.34`, `8.4.0`,
 * `5.7.42-log`, `10.6.11-MariaDB-...`. We only care about the
 * leading integer for the floor check; MariaDB's 10.x is treated
 * as 10 (above the 8 floor).
 */
export function parseMysqlMajorVersion(version: string): number | null {
  const m = /^(\d+)\./.exec(version.trim())
  if (!m) return null
  const major = Number(m[1])
  return Number.isFinite(major) ? major : null
}

/**
 * MigrationAdapter implementation backed by mysql2.
 *
 * Asserts MySQL 8.0+ on first connection (via the first
 * `ensureMigrationTables` call, lazily — no I/O at construction
 * time). Earlier versions throw `KickDbError` with code
 * `KICK_DB_RELATIONAL_NOT_SUPPORTED` carrying the detected version
 * so adopters get a clear error before any query reaches the
 * relational compiler.
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
    const [rows] = await pool.query<{ version: string }>(`SELECT VERSION() AS \`version\``)
    const versionString = rows[0]?.version ?? ''
    const major = parseMysqlMajorVersion(versionString)
    if (major == null || major < MIN_MYSQL_MAJOR) {
      throw new KickDbError(
        'KICK_DB_RELATIONAL_NOT_SUPPORTED',
        `MySQL ${MIN_MYSQL_MAJOR}.0+ required for the relational query layer ` +
          `(JSON_ARRAYAGG shipped in 8.0); detected version: ${versionString || '<unknown>'}. ` +
          `Use a layer-1/layer-2 query (selectFrom / selectAll) on older MySQL versions.`,
      )
    }
    versionVerified = true
  }

  return {
    dialect,

    async ensureMigrationTables() {
      await assertVersion()
      await pool.query(migrationsTableDdl(dialect))
      await pool.query(lockTableDdl(dialect))
    },

    async listApplied(): Promise<MigrationRow[]> {
      const [rows] = await pool.query<{
        id: string
        name: string
        hash: string
        batch: number
        applied_at: string | Date
        direction: 'up' | 'down'
      }>(
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
      // mysql2's query() returns [result, fields] for UPDATE where
      // result has affectedRows. Cast through unknown to the result.
      const [result] = (await pool.query(
        `UPDATE \`kick_migrations_lock\`
         SET locked_at = CURRENT_TIMESTAMP, locked_by = ?
         WHERE id = 1 AND locked_at IS NULL`,
        [owner],
      )) as unknown as [{ affectedRows: number }, unknown]
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
        await conn.query(sql)
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
      await pool.query(sql)
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
