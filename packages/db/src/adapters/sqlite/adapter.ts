import { Kysely } from 'kysely'
import { sqliteDialect } from './dialect'
import {
  lockTableDdl,
  lockTableName,
  KICK_PUSH_TABLE,
  quoteTable,
  KICK_MIGRATIONS_TABLE,
  migrationsTableDdl,
  type Dialect,
  type MigrationAdapter,
  type MigrationBookkeeping,
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
/**
 * `all` / `get` are deliberately NOT method-generic: better-sqlite3
 * v12's own `Statement` methods are non-generic, so generic signatures
 * here would make a real `Database` instance structurally incompatible
 * (callers had to cast — same fix as `SqliteIntrospectDb`). Row typing
 * happens at the call sites via assertions instead.
 */
export interface SqliteStatement {
  run(...params: readonly unknown[]): { changes: number; lastInsertRowid: number | bigint }
  all(...params: readonly unknown[]): unknown[]
  get(...params: readonly unknown[]): unknown
}

export interface SqliteDatabaseLike {
  prepare(sql: string): SqliteStatement
  exec(sql: string): unknown
  close(): unknown
}

export interface SqliteAdapterOptions {
  /**
   * The table migrations are recorded in. Default `kick_migrations`; its lock
   * table is the same name plus `_lock`.
   */
  migrationsTable?: string
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
 * Introspection: `introspect()` walks `sqlite_master` + `PRAGMA` via
 * {@link introspectSqlite}. Types come back as SQLite affinities (lossy
 * vs the code-first DSL), so it powers `kick db introspect` rather than
 * byte-exact drift detection.
 */
export function sqliteAdapter(opts: SqliteAdapterOptions): MigrationAdapter {
  const dialect: Dialect = 'sqlite'
  const { database } = opts

  // Multi-statement DDL runs through better-sqlite3's exec() (it
  // handles `;`-separated batches natively).
  const runBatch = (sql: string) => database.exec(sql)

  const table = opts.migrationsTable ?? KICK_MIGRATIONS_TABLE
  const T = quoteTable(dialect, table)
  const L = quoteTable(dialect, lockTableName(table))
  // Introspection must not report the bookkeeping tables as schema.
  // A dot is part of the name here, not a schema.
  const bookkeepingTables = [table, lockTableName(table), KICK_PUSH_TABLE]
  let migrationDb: Kysely<any> | undefined
  return {
    dialect,

    async ensureMigrationTables() {
      runBatch(migrationsTableDdl(dialect, table))
      runBatch(lockTableDdl(dialect, table))
    },

    async listApplied(): Promise<MigrationRow[]> {
      const rows = database
        .prepare(
          `SELECT id, name, hash, batch, applied_at, direction
           FROM ${T}
           ORDER BY applied_at ASC, id ASC`,
        )
        .all() as {
        id: string
        name: string
        hash: string
        batch: number
        applied_at: string
        direction: 'up' | 'down'
      }[]
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
          `INSERT INTO ${T} (id, name, hash, batch, direction)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(row.id, row.name, row.hash, row.batch, row.direction)
    },

    async removeApplied(id: string) {
      database.prepare(`DELETE FROM ${T} WHERE id = ?`).run(id)
    },

    async acquireLock(owner: string): Promise<boolean> {
      const r = database
        .prepare(
          `UPDATE ${L}
           SET locked_at = datetime('now'), locked_by = ?
           WHERE id = 1 AND locked_at IS NULL`,
        )
        .run(owner)
      return r.changes === 1
    },

    async releaseLock() {
      database
        .prepare(
          `UPDATE ${L}
           SET locked_at = NULL, locked_by = NULL
           WHERE id = 1`,
        )
        .run()
    },

    async applySqlInTx(sql: string) {
      await this.applyMigrationInTx!(sql, null)
    },

    async applyMigrationInTx(sql: string, bookkeeping: MigrationBookkeeping | null) {
      // BEGIN / COMMIT around a multi-statement batch gives us
      // atomicity. SQLite rolls back to pre-BEGIN on any error
      // inside the block.
      runBatch('BEGIN')
      try {
        runBatch(sql)
        if (bookkeeping && 'record' in bookkeeping) {
          const r = bookkeeping.record
          database
            .prepare(
              `INSERT INTO ${T} (id, name, hash, batch, direction)
               VALUES (?, ?, ?, ?, ?)`,
            )
            .run(r.id, r.name, r.hash, r.batch, r.direction)
        } else if (bookkeeping) {
          database.prepare(`DELETE FROM ${T} WHERE id = ?`).run(bookkeeping.remove)
        }
        // A table rebuild copies rows into a fresh table; check no row now
        // points at a parent that isn't there before committing it.
        // The tables this migration rebuilt, read from the rebuild's final rename.
        const rebuilt = new Set(
          [...sql.matchAll(/ALTER TABLE "_kick_new_((?:[^"]|"")+)" RENAME TO/g)].map((m) =>
            m[1]!.replace(/""/g, '"'),
          ),
        )
        if (rebuilt.size > 0) {
          // A rebuilt table can be the child or the parent of a broken key;
          // orphans elsewhere predate this migration and aren't its to fail on.
          const broken = (
            database.prepare('PRAGMA foreign_key_check').all() as Array<{
              table: string
              parent: string
            }>
          ).filter((r) => rebuilt.has(r.table) || rebuilt.has(r.parent))
          if (broken.length > 0) {
            const where = [...new Set(broken.map((r) => `${r.table} → ${r.parent}`))].join(', ')
            throw new Error(
              `kickjs-db: the migration left ${broken.length} row(s) whose foreign key points ` +
                `at a missing row (${where}); rolled back. Fix the data, then migrate again.`,
            )
          }
        }
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
      return introspectSqlite(database, { excludeTables: bookkeepingTables })
    },

    migrationsTable: table,

    kysely() {
      // Built once, on the same connection. Never destroyed here: the pool or
      // handle belongs to the caller (or to close()).
      return (migrationDb ??= new Kysely<any>({
        dialect: sqliteDialect({ database: database as never }),
      }))
    },

    async close() {
      // Caller owns the database handle. The adapter doesn't close
      // it — adopters typically share the same handle with the
      // KickDbClient.
    },
  }
}
