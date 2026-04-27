import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Dialect } from '../snapshot/types'

export interface DbConfig {
  schemaPath: string
  migrationsDir: string
  dialect: Dialect
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
  }
}
