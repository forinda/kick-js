import {
  introspectPg,
  lockTableDdl,
  migrationsTableDdl,
  type Dialect,
  type MigrationAdapter,
  type MigrationRow,
  type SchemaSnapshot,
} from '@forinda/kickjs-db'

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
}

export interface PgAdapterOptions {
  /**
   * A pg-protocol-compatible Pool. Concretely: pg.Pool, neon-serverless Pool,
   * any other Pool that satisfies the {@link PgPoolLike} structural shape.
   */
  pool: PgPoolLike
  /** PG schema name to scope the introspector and validate at construction. Default 'public'. */
  schema?: string
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
  const dialect: Dialect = 'postgres'
  const { pool } = opts
  const schema = opts.schema ?? 'public'
  if (!SAFE_SCHEMA_NAME.test(schema)) {
    // Schema name lands inside introspection queries unparameterised so guard
    // here rather than down at the SQL boundary.
    throw new Error(`Invalid PG schema name: ${schema}`)
  }

  return {
    dialect,

    async ensureMigrationTables() {
      await pool.query(migrationsTableDdl(dialect))
      await pool.query(lockTableDdl(dialect))
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
         FROM kick_migrations
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
        `INSERT INTO kick_migrations (id, name, hash, batch, direction)
         VALUES ($1, $2, $3, $4, $5)`,
        [row.id, row.name, row.hash, row.batch, row.direction],
      )
    },

    async removeApplied(id: string) {
      await pool.query(`DELETE FROM kick_migrations WHERE id = $1`, [id])
    },

    async acquireLock(owner: string): Promise<boolean> {
      const r = await pool.query(
        `UPDATE kick_migrations_lock
         SET locked_at = CURRENT_TIMESTAMP, locked_by = $1
         WHERE id = 1 AND locked_at IS NULL`,
        [owner],
      )
      return r.rowCount === 1
    },

    async releaseLock() {
      await pool.query(
        `UPDATE kick_migrations_lock
         SET locked_at = NULL, locked_by = NULL
         WHERE id = 1`,
      )
    },

    async applySqlInTx(sql: string) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query(sql)
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
      return introspectPg(pool, { schema })
    },

    async close() {
      // Caller owns the pool. kickDbAdapter's shutdown lifecycle calls this so
      // future adapter-internal teardown (e.g. cancelling pending observers)
      // has a hook, but we deliberately don't end() the shared pool.
    },
  }
}
