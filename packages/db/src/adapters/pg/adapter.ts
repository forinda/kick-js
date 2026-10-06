import { Kysely } from 'kysely'
import { pgDialect } from './dialect'
import {
  introspectPg,
  KickDbError,
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

/**
 * Minimal client returned by PgPoolLike.connect(). Matches the shape of
 * pg.PoolClient and @neondatabase/serverless's PoolClient.
 */
export interface PgClientLike {
  query<R = unknown>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>
  release(): void
}

/**
 * Pool-shaped contract that pgAdapter consumes. Both `pg.Pool` and
 * `@neondatabase/serverless`'s Pool match this structurally — no hard
 * dependency on the `pg` package. Adopters pick whichever pg-protocol-
 * compatible client fits their runtime (node-postgres / neon-serverless /
 * pg-cloudflare / etc).
 *
 * Edge runtimes with a different surface (Neon HTTP single-shot,
 * Cloudflare D1's batch-only model) have their own adapter packages that
 * implement MigrationAdapter directly — they don't reuse this shape.
 */
export interface PgPoolLike {
  query<R = unknown>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>
  connect(): Promise<PgClientLike>
  end?(): Promise<void>
}

export interface PgAdapterOptions {
  /**
   * The table migrations are recorded in. Default `kick_migrations`; its lock
   * table is the same name plus `_lock`. On Postgres it may be schema-qualified
   * (`meta.kick_migrations`); the schema is created if missing.
   */
  migrationsTable?: string
  /**
   * A pg-protocol-compatible Pool. Concretely: pg.Pool, neon-serverless Pool,
   * any other Pool that satisfies the {@link PgPoolLike} structural shape.
   */
  pool: PgPoolLike
  /** PG schema name to scope the introspector and validate at construction. Default 'public'. */
  schema?: string
  /**
   * End the pool when the adapter closes. Set it when the adapter owns its
   * pool — a `kick.config.ts` `db.adapter()` factory that opens one for the
   * CLI — or the `kick db` command waits for idle clients to time out.
   * Default `false`: an app usually shares one pool with its client.
   */
  endPoolOnClose?: boolean
}

const SAFE_SCHEMA_NAME = /^[a-z_][a-z0-9_]*$/i

/**
 * MigrationAdapter implementation backed by node-postgres. The pool is
 * caller-owned — close() does NOT end() the pool because adopters typically
 * share a single pool across the migrationAdapter and the KickDbClient.
 *
 * Lock semantics: single-row UPDATE WHERE locked_at IS NULL on
 * kick_migrations_lock. Only the row created by ensureMigrationTables()
 * exists, so the UPDATE either flips locked_at and returns rowCount=1
 * (we won) or matches zero rows (someone else holds it).
 */
export function pgAdapter(opts: PgAdapterOptions): MigrationAdapter {
  if (opts.endPoolOnClose && typeof opts.pool.end !== 'function') {
    throw new KickDbError(
      'KICK_DB_POOL_NOT_CLOSABLE',
      'pgAdapter({ endPoolOnClose: true }) needs a pool with an end() method to close',
    )
  }
  const dialect: Dialect = 'postgres'
  const { pool } = opts
  const schema = opts.schema ?? 'public'
  if (!SAFE_SCHEMA_NAME.test(schema)) {
    // Schema name lands inside introspection queries unparameterised so guard
    // here rather than down at the SQL boundary.
    throw new Error(`Invalid PG schema name: ${schema}`)
  }

  const table = opts.migrationsTable ?? KICK_MIGRATIONS_TABLE
  const T = quoteTable(dialect, table)
  const L = quoteTable(dialect, lockTableName(table))
  // Introspection must not report the bookkeeping tables as schema.
  // Postgres reads a dotted name as schema.table. Introspection reads one
  // schema and matches bare names, so the tables are only left out when they
  // live in that schema — elsewhere, a same-named table here is the user's.
  const bookkeepingSchema = table.includes('.') ? table.slice(0, table.lastIndexOf('.')) : schema
  const bookkeepingTables =
    bookkeepingSchema === schema
      ? [table, lockTableName(table)].map((t) => t.slice(t.lastIndexOf('.') + 1))
      : []
  bookkeepingTables.push(KICK_PUSH_TABLE)
  let migrationDb: Kysely<any> | undefined
  return {
    dialect,

    async ensureMigrationTables() {
      await pool.query(migrationsTableDdl(dialect, table))
      await pool.query(lockTableDdl(dialect, table))
    },

    async listApplied(): Promise<MigrationRow[]> {
      const r = await pool.query<{
        id: string
        name: string
        hash: string
        batch: number | string
        applied_at: string | Date
        direction: 'up' | 'down'
      }>(
        `SELECT id, name, hash, batch, applied_at, direction
         FROM ${T}
         ORDER BY applied_at ASC, id ASC`,
      )
      return r.rows.map((row) => ({
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
         VALUES ($1, $2, $3, $4, $5)`,
        [row.id, row.name, row.hash, row.batch, row.direction],
      )
    },

    async removeApplied(id: string) {
      await pool.query(`DELETE FROM ${T} WHERE id = $1`, [id])
    },

    async acquireLock(owner: string): Promise<boolean> {
      const r = await pool.query(
        `UPDATE ${L}
         SET locked_at = CURRENT_TIMESTAMP, locked_by = $1
         WHERE id = 1 AND locked_at IS NULL`,
        [owner],
      )
      return r.rowCount === 1
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

    async applyMigrationInTx(sql: string, bookkeeping: MigrationBookkeeping | null) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query(sql)
        if (bookkeeping && 'record' in bookkeeping) {
          const r = bookkeeping.record
          await client.query(
            `INSERT INTO ${T} (id, name, hash, batch, direction)
             VALUES ($1, $2, $3, $4, $5)`,
            [r.id, r.name, r.hash, r.batch, r.direction],
          )
        } else if (bookkeeping) {
          await client.query(`DELETE FROM ${T} WHERE id = $1`, [bookkeeping.remove])
        }
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {
          /* swallow rollback errors; we're already throwing the original */
        })
        throw err
      } finally {
        client.release()
      }
    },

    async applySqlNoTx(sql: string) {
      await pool.query(sql)
    },

    async introspect(): Promise<SchemaSnapshot> {
      return introspectPg(pool, { schema, excludeTables: bookkeepingTables })
    },

    migrationsTable: table,

    kysely() {
      // Built once, on the same connection. Never destroyed here: the pool or
      // handle belongs to the caller (or to close()).
      return (migrationDb ??= new Kysely<any>({ dialect: pgDialect({ pool: pool as never }) }))
    },

    async close() {
      // The caller owns the pool unless it said otherwise — adopters
      // typically share it with the KickDbClient.
      if (opts.endPoolOnClose) await opts.pool.end?.()
    },
  }
}
