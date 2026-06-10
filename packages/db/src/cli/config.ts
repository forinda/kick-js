import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Dialect } from '../snapshot/types'
import type { MigrationAdapter } from '../migrate/adapter'
import type { DriftBehavior } from '../migrate/drift'

export type MigrationAdapterFactory = () => MigrationAdapter | Promise<MigrationAdapter>

export interface DbConfig {
  schemaPath: string
  migrationsDir: string
  dialect: Dialect
  /**
   * How `kick db migrate` reacts when the live DB has schema not recorded
   * in the migrations (someone ran DDL out of band): `'error'` (default —
   * refuse), `'warn'` (log + continue), `'ignore'` (skip the check). The
   * check is dialect-normalised, so SQLite/MySQL's lossy introspection
   * doesn't false-positive.
   */
  driftCheck?: DriftBehavior
  /**
   * Postgres connection string for the built-in pgAdapter path. Read from
   * `db.connectionString` in kick.config.ts, or falls back to the
   * DATABASE_URL env var. The CLI uses this when no `adapter` factory is
   * provided.
   */
  connectionString?: string
  /**
   * Escape hatch: a factory returning a fully-constructed MigrationAdapter.
   * Takes precedence over `connectionString` when both are set. Use this
   * for non-default adapter wiring (custom pool, neon-serverless, etc).
   */
  adapter?: MigrationAdapterFactory
}

export async function resolveDbConfig(opts: { configPath: string }): Promise<DbConfig> {
  const abs = path.resolve(opts.configPath)
  const mod = await import(pathToFileURL(abs).href)
  const cfg = mod.default ?? mod
  const db = cfg?.db ?? {}
  return {
    schemaPath: db.schemaPath ?? 'src/db/schema.ts',
    migrationsDir: db.migrationsDir ?? 'db/migrations',
    dialect: db.dialect ?? 'postgres',
    connectionString: db.connectionString ?? process.env.DATABASE_URL,
    adapter: db.adapter,
    driftCheck: db.driftCheck,
  }
}
