import type { Dialect, SchemaSnapshot } from '../snapshot/types'

export interface MigrationRow {
  id: string
  name: string
  hash: string
  batch: number
  appliedAt: string
  direction: 'up' | 'down'
}

/**
 * Slim contract that connects the runner to a concrete database driver.
 *
 * Concrete impls: MemoryMigrationAdapter (this package, test-only) and
 * pgAdapter from @forinda/kickjs-db/pg. Future db-sqlite / db-mysql adapter
 * packages will satisfy this same shape so the runner stays driver-agnostic.
 */
export interface MigrationAdapter {
  readonly dialect: Dialect
  /** Idempotent CREATE TABLE IF NOT EXISTS for kick_migrations + kick_migrations_lock. */
  ensureMigrationTables(): Promise<void>
  /** Read all applied migrations ordered by appliedAt asc, then id asc. */
  listApplied(): Promise<MigrationRow[]>
  /** Insert a new applied migration row; appliedAt is set by the DB. */
  recordApplied(row: Omit<MigrationRow, 'appliedAt'>): Promise<void>
  /** Delete an applied migration row (used by `migrate down`). */
  removeApplied(id: string): Promise<void>
  /** Atomic lock acquire — true if we got it, false if held. Owner string is recorded for diagnostics. */
  acquireLock(owner: string): Promise<boolean>
  /** Release the lock (no-op if not held). */
  releaseLock(): Promise<void>
  /** Run arbitrary SQL inside a transaction. Used to apply up.sql / down.sql. */
  applySqlInTx(sql: string): Promise<void>
  /** Apply SQL outside any transaction — for migrations with `meta.transaction: false` (CREATE INDEX CONCURRENTLY etc). */
  applySqlNoTx(sql: string): Promise<void>
  /** Introspect the live schema; returns the canonical SchemaSnapshot. Used by drift detection and `kick db introspect`. */
  introspect(): Promise<SchemaSnapshot>
  /** Close any underlying pool / connection. Caller-owned resources may keep the no-op. */
  close(): Promise<void>
}
