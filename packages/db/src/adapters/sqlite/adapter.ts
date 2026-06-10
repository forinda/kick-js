import {
  KickDbError,
  lockTableDdl,
  migrationsTableDdl,
  type Dialect,
  type MigrationAdapter,
  type MigrationRow,
  type SchemaSnapshot,
} from '../../index'
import { introspectSqlite } from '../../migrate/introspect-sqlite'

/**
 * better-sqlite3-shaped database handle that `sqliteAdapter` consumes.
 * Mirrors the methods we actually use; both `new Database(...)` from
 * `better-sqlite3` and bun's `bun:sqlite` Database match structurally.
 *
 * better-sqlite3's API is synchronous — we wrap everything in `async`
 * to match the `MigrationAdapter` contract. No I/O actually awaits;
 * the wrapping is for shape compatibility.
 */
export interface SqliteStatement {
  run(...params: readonly unknown[]): { changes: number; lastInsertRowid: number | bigint }
  all<R = unknown>(...params: readonly unknown[]): R[]
  get<R = unknown>(...params: readonly unknown[]): R | undefined
}

export interface SqliteDatabaseLike {
  prepare(sql: string): SqliteStatement
  exec(sql: string): unknown
  close(): unknown
}

export interface SqliteAdapterOptions {
  /**
   * better-sqlite3 (or compatible) Database handle. Caller-owned —
   * the adapter's `close()` does NOT close the database because
   * adopters typically share a single handle across the migration
   * adapter and the KickDbClient.
   */
  database: SqliteDatabaseLike
}

/**
 * MigrationAdapter implementation backed by better-sqlite3.
 *
 * Lock semantics: single-row UPDATE WHERE locked_at IS NULL on
 * `kick_migrations_lock`. Only the row created by `ensureMigrationTables()`
 * exists, so the UPDATE either flips `locked_at` and returns
 * `changes=1` (we won) or matches zero rows (someone else holds it).
 *
 * Introspection: not implemented in v1 — throws `KickDbError` with
 * code `KICK_DB_INTROSPECT_NOT_SUPPORTED`. Drift detection lands in a
 * follow-up that walks `sqlite_master` + `pragma` queries.
 */
export function sqliteAdapter(opts: SqliteAdapterOptions): MigrationAdapter {
  const dialect: Dialect = 'sqlite'
  const { database } = opts

  // Multi-statement DDL runs through better-sqlite3's exec() (it
  // handles `;`-separated batches natively).
  const runBatch = (sql: string) => database.exec(sql)

  return {
    dialect,

    async ensureMigrationTables() {
      runBatch(migrationsTableDdl(dialect))
      runBatch(lockTableDdl(dialect))
    },

    async listApplied(): Promise<MigrationRow[]> {
      const rows = database
        .prepare(
          `SELECT id, name, hash, batch, applied_at, direction
           FROM kick_migrations
           ORDER BY applied_at ASC, id ASC`,
        )
        .all<{
          id: string
          name: string
          hash: string
          batch: number
          applied_at: string
          direction: 'up' | 'down'
        }>()
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        hash: row.hash,
        batch: Number(row.batch),
        appliedAt: row.applied_at,
        direction: row.direction,
      }))
    },

    async recordApplied(row) {
      database
        .prepare(
          `INSERT INTO kick_migrations (id, name, hash, batch, direction)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(row.id, row.name, row.hash, row.batch, row.direction)
    },

    async removeApplied(id: string) {
      database.prepare(`DELETE FROM kick_migrations WHERE id = ?`).run(id)
    },

    async acquireLock(owner: string): Promise<boolean> {
      const r = database
        .prepare(
          `UPDATE kick_migrations_lock
           SET locked_at = datetime('now'), locked_by = ?
           WHERE id = 1 AND locked_at IS NULL`,
        )
        .run(owner)
      return r.changes === 1
    },

    async releaseLock() {
      database
        .prepare(
          `UPDATE kick_migrations_lock
           SET locked_at = NULL, locked_by = NULL
           WHERE id = 1`,
        )
        .run()
    },

    async applySqlInTx(sql: string) {
      // BEGIN / COMMIT around a multi-statement batch gives us
      // atomicity. SQLite rolls back to pre-BEGIN on any error
      // inside the block.
      runBatch('BEGIN')
      try {
        runBatch(sql)
        runBatch('COMMIT')
      } catch (err) {
        try {
          runBatch('ROLLBACK')
        } catch {
          // Swallow rollback errors; we're already throwing the original.
        }
        throw err
      }
    },

    async applySqlNoTx(sql: string) {
      runBatch(sql)
    },

    async introspect(): Promise<SchemaSnapshot> {
      // Reverse-engineer the live schema via sqlite_master + PRAGMA walks.
      // Types come back as SQLite affinities (a code-first `uuid()` reads as
      // `text`), so this powers `kick db introspect`; byte-exact drift
      // against a code-first snapshot needs a dialect-normalised compare.
      return introspectSqlite(database)
    },

    async close() {
      // Caller owns the database handle. The adapter doesn't close
      // it — adopters typically share the same handle with the
      // KickDbClient.
    },
  }
}
