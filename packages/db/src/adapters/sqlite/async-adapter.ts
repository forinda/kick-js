import type { Kysely } from 'kysely'
import {
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
import { introspectSqliteAsync } from '../../migrate/introspect-sqlite'
import { splitSqlStatements } from '../../migrate/split-statements'

/** One statement and its parameters. */
export interface SqliteStatementInput {
  sql: string
  params?: readonly unknown[]
}

/**
 * The two things an async SQLite driver (libsql/Turso, Cloudflare D1) has to
 * offer for migrations. Wrap your client with {@link libsqlDriver} or
 * {@link d1Driver}, or implement it for another driver.
 */
export interface AsyncSqliteDriver {
  /** Run one statement and resolve with its rows (empty for a write). */
  query(sql: string, params?: readonly unknown[]): Promise<unknown[]>
  /** Run statements atomically, in order: all of them apply, or none. */
  batch(statements: readonly SqliteStatementInput[]): Promise<void>
}

export interface AsyncSqliteAdapterOptions {
  driver: AsyncSqliteDriver
  /**
   * A Kysely instance on the same database, for migrations written in
   * TypeScript (`migration.ts`). Without it, only SQL migrations run.
   */
  kysely?: Kysely<any>
  /**
   * The table migrations are recorded in. Default `kick_migrations`; its lock
   * table is the same name plus `_lock`.
   */
  migrationsTable?: string
  /**
   * Called by `close()`, so a client opened for `kick db` can end when the
   * command finishes: `close: () => client.close()`. The client is otherwise
   * the caller's.
   */
  close?: () => unknown
}

/**
 * Migrations on an async SQLite driver: libsql/Turso, Cloudflare D1, or any
 * driver that can run a statement and an atomic batch.
 *
 * Each migration is applied as one batch: its statements, then its
 * `kick_migrations` row, then — when it rebuilt a table — a statement that
 * fails if a foreign key now points at a missing row. A failure anywhere
 * rolls the whole batch back. The batch replaces `BEGIN`/`COMMIT`, which D1
 * doesn't allow, so `meta.transaction: false` migrations run statement by
 * statement instead.
 */
export function asyncSqliteAdapter(opts: AsyncSqliteAdapterOptions): MigrationAdapter {
  const dialect: Dialect = 'sqlite'
  const { driver } = opts
  const table = opts.migrationsTable ?? KICK_MIGRATIONS_TABLE
  const T = quoteTable(dialect, table)
  const L = quoteTable(dialect, lockTableName(table))
  const bookkeepingTables = [table, lockTableName(table)]
  const statements = (sql: string): SqliteStatementInput[] =>
    splitSqlStatements(sql, 'sqlite').map((s) => ({ sql: s }))
  const insertRow = (r: Omit<MigrationRow, 'appliedAt'>): SqliteStatementInput => ({
    sql: `INSERT INTO ${T} (id, name, hash, batch, direction) VALUES (?, ?, ?, ?, ?)`,
    params: [r.id, r.name, r.hash, r.batch, r.direction],
  })
  const deleteRow = (id: string): SqliteStatementInput => ({
    sql: `DELETE FROM ${T} WHERE id = ?`,
    params: [id],
  })

  return {
    dialect,

    async ensureMigrationTables() {
      await driver.batch([
        ...statements(migrationsTableDdl(dialect, table)),
        ...statements(lockTableDdl(dialect, table)),
      ])
    },

    async listApplied(): Promise<MigrationRow[]> {
      const rows = (await driver.query(
        `SELECT id, name, hash, batch, applied_at, direction FROM ${T}
         ORDER BY applied_at ASC, id ASC`,
      )) as Array<{
        id: string
        name: string
        hash: string
        batch: number
        applied_at: string
        direction: 'up' | 'down'
      }>
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
      const s = insertRow(row)
      await driver.query(s.sql, s.params)
    },

    async removeApplied(id) {
      const s = deleteRow(id)
      await driver.query(s.sql, s.params)
    },

    async acquireLock(owner) {
      // RETURNING tells us whether this UPDATE took the lock (SQLite 3.35+).
      const won = await driver.query(
        `UPDATE ${L} SET locked_at = datetime('now'), locked_by = ?
         WHERE id = 1 AND locked_at IS NULL RETURNING id`,
        [owner],
      )
      return won.length === 1
    },

    async releaseLock() {
      await driver.query(`UPDATE ${L} SET locked_at = NULL, locked_by = NULL WHERE id = 1`)
    },

    async applySqlInTx(sql) {
      await this.applyMigrationInTx!(sql, null)
    },

    async applyMigrationInTx(sql: string, bookkeeping: MigrationBookkeeping | null) {
      const batch = statements(sql)
      if (bookkeeping && 'record' in bookkeeping) batch.push(insertRow(bookkeeping.record))
      else if (bookkeeping) batch.push(deleteRow(bookkeeping.remove))
      const guard = foreignKeyGuard(sql)
      if (guard) batch.push(guard)
      if (batch.length === 0) return
      try {
        await driver.batch(batch)
      } catch (err) {
        // The guard fails with SQLite's own "malformed JSON"; say what it means.
        if (guard && /malformed JSON/i.test(String((err as Error)?.message))) {
          throw new Error(
            'kickjs-db: the migration left rows whose foreign key points at a missing row; ' +
              'rolled back. Fix the data, then migrate again.',
            { cause: err },
          )
        }
        throw err
      }
    },

    async applySqlNoTx(sql) {
      for (const s of statements(sql)) await driver.query(s.sql)
    },

    async introspect(): Promise<SchemaSnapshot> {
      return introspectSqliteAsync((sql, params) => driver.query(sql, params), {
        excludeTables: bookkeepingTables,
      })
    },

    migrationsTable: table,

    ...(opts.kysely ? { kysely: () => opts.kysely! } : {}),

    async close() {
      await opts.close?.()
    },
  }
}

/**
 * After a table rebuild (rows copied into a fresh table), a statement that
 * fails when a rebuilt table is the child or the parent of a broken foreign
 * key. It's the last statement of the batch, so failing it rolls the
 * migration back. `json()` on a non-JSON string is the error (SQLite has no
 * `raise()` outside triggers); the adapter rewords it.
 */
function foreignKeyGuard(sql: string): SqliteStatementInput | undefined {
  const rebuilt = [
    ...new Set(
      [...sql.matchAll(/ALTER TABLE "_kick_new_((?:[^"]|"")+)" RENAME TO/g)].map((m) =>
        m[1]!.replace(/""/g, '"'),
      ),
    ),
  ]
  if (rebuilt.length === 0) return undefined
  const marks = rebuilt.map(() => '?').join(', ')
  return {
    sql: `SELECT CASE WHEN EXISTS (
            SELECT 1 FROM pragma_foreign_key_check
            WHERE "table" IN (${marks}) OR "parent" IN (${marks})
          ) THEN json('not json') END`,
    params: [...rebuilt, ...rebuilt],
  }
}

/** The part of `@libsql/client`'s `Client` that {@link libsqlDriver} uses. */
export interface LibsqlClientLike {
  execute(stmt: { sql: string; args: any[] }): Promise<{ rows: ArrayLike<unknown> }>
  batch(
    stmts: Array<{ sql: string; args: any[] }>,
    mode?: 'write' | 'read' | 'deferred',
  ): Promise<unknown>
}

/** {@link AsyncSqliteDriver} over a libsql/Turso client (`@libsql/client`). */
export function libsqlDriver(client: LibsqlClientLike): AsyncSqliteDriver {
  return {
    async query(sql, params = []) {
      const result = await client.execute({ sql, args: [...params] })
      return Array.from(result.rows)
    },
    async batch(statements) {
      await client.batch(
        statements.map((s) => ({ sql: s.sql, args: [...(s.params ?? [])] })),
        'write',
      )
    },
  }
}

/** The part of Cloudflare D1's `D1Database` that {@link d1Driver} uses. */
export interface D1DatabaseLike {
  prepare(sql: string): D1StatementLike
  batch(statements: D1StatementLike[]): Promise<unknown>
}

export interface D1StatementLike {
  bind(...values: unknown[]): D1StatementLike
  all(): Promise<{ results?: unknown[] }>
}

/** {@link AsyncSqliteDriver} over a Cloudflare D1 binding. */
export function d1Driver(db: D1DatabaseLike): AsyncSqliteDriver {
  const prepare = (sql: string, params: readonly unknown[] = []) =>
    params.length > 0 ? db.prepare(sql).bind(...params) : db.prepare(sql)
  return {
    async query(sql, params) {
      return (await prepare(sql, params).all()).results ?? []
    },
    async batch(statements) {
      // D1 runs a batch as one transaction.
      await db.batch(statements.map((s) => prepare(s.sql, s.params)))
    },
  }
}
