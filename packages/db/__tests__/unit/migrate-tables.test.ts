import { describe, it, expect } from 'vitest'
import { migrationsTableDdl, lockTableDdl } from '@forinda/kickjs-db'

describe('migration table DDL', () => {
  it('PG migrations table uses double-quoted identifiers', () => {
    const sql = migrationsTableDdl('postgres')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "kick_migrations"')
    expect(sql).toContain('"id" varchar(128) PRIMARY KEY')
  })

  it('PG lock seeds the single row idempotently', () => {
    const sql = lockTableDdl('postgres')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "kick_migrations_lock"')
    expect(sql).toContain(
      `INSERT INTO "kick_migrations_lock" ("id") VALUES (1) ON CONFLICT DO NOTHING`,
    )
  })

  it('SQLite uses INSERT OR IGNORE for lock seeding', () => {
    expect(lockTableDdl('sqlite')).toContain('INSERT OR IGNORE')
  })

  it('MySQL uses INSERT IGNORE + backticks', () => {
    expect(lockTableDdl('mysql')).toContain('INSERT IGNORE')
    expect(migrationsTableDdl('mysql')).toContain('`kick_migrations`')
  })
})
