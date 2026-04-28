import type { Dialect, SchemaSnapshot } from '../snapshot/types'
import type { MigrationAdapter, MigrationRow } from './adapter'

/**
 * In-memory MigrationAdapter for unit tests. Lock semantics are exact (single-
 * holder atomic), but applySqlInTx / applySqlNoTx / introspect are shaped as
 * test-only stubs — the real DB-bound semantics are validated in db-pg's
 * integration tests, not here.
 */
export class MemoryMigrationAdapter implements MigrationAdapter {
  readonly dialect: Dialect = 'postgres'

  private rows: MigrationRow[] = []
  private locked: { by: string; at: string } | null = null
  private appliedSql: string[] = []
  private currentSchema: SchemaSnapshot = { version: 1, dialect: 'postgres', tables: {} }

  async ensureMigrationTables(): Promise<void> {
    /* no-op */
  }

  async listApplied(): Promise<MigrationRow[]> {
    return [...this.rows]
  }

  async recordApplied(row: Omit<MigrationRow, 'appliedAt'>): Promise<void> {
    this.rows.push({ ...row, appliedAt: new Date().toISOString() })
  }

  async removeApplied(id: string): Promise<void> {
    this.rows = this.rows.filter((r) => r.id !== id)
  }

  async acquireLock(owner: string): Promise<boolean> {
    if (this.locked) return false
    this.locked = { by: owner, at: new Date().toISOString() }
    return true
  }

  async releaseLock(): Promise<void> {
    this.locked = null
  }

  async applySqlInTx(sql: string): Promise<void> {
    this.appliedSql.push(sql)
  }

  async applySqlNoTx(sql: string): Promise<void> {
    this.appliedSql.push(sql)
  }

  async introspect(): Promise<SchemaSnapshot> {
    return this.currentSchema
  }

  async close(): Promise<void> {
    /* no-op */
  }

  /** Test-only setter — let drift tests stage a "live" schema state. */
  __setIntrospectedSchema(snap: SchemaSnapshot): void {
    this.currentSchema = snap
  }

  /** Test-only inspector — what SQL we received. */
  __appliedSql(): readonly string[] {
    return this.appliedSql
  }
}
