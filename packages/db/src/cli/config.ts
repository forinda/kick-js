import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Dialect } from '../snapshot/types'
import type { MigrationAdapter } from '../migrate/adapter'

export type MigrationAdapterFactory = () => MigrationAdapter | Promise<MigrationAdapter>

export interface DbConfig {
  schemaPath: string
  migrationsDir: string
  dialect: Dialect
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
  }
}
