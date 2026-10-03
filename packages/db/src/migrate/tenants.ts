import type { MigrationAdapter } from './adapter'
import { migrateLatest, type AppliedSummary, type RunnerOptions } from './runner'

export interface MigrateTenantsOptions extends Omit<RunnerOptions, 'adapter'> {
  /** The tenants to migrate, or a function returning them (read from the central database). */
  tenants: readonly string[] | (() => readonly string[] | Promise<readonly string[]>)
  /**
   * The migration adapter for one tenant: its database (`'database'`), or a
   * connection whose `search_path` is its schema (`'schema'`). Closed after
   * that tenant is migrated.
   */
  adapterFor: (tenantId: string) => MigrationAdapter | Promise<MigrationAdapter>
  /** Tenants migrated at once. Default 1. */
  concurrency?: number
  /** Stop at the first failure. Default false: migrate the rest and report every failure. */
  stopOnError?: boolean
  /** Called as each tenant finishes. */
  onTenant?: (result: TenantMigrationResult) => void
}

export interface TenantMigrationResult {
  tenant: string
  /** What was applied, when it succeeded. */
  summary?: AppliedSummary
  error?: unknown
}

export interface MigrateTenantsResult {
  results: TenantMigrationResult[]
  /** The tenants whose migration failed. */
  failed: string[]
}

/**
 * Run the same migrations for every tenant — schema- or database-per-tenant.
 * Each tenant keeps its own `kick_migrations`, so a tenant added later (or
 * one that failed) catches up on the next run.
 */
export async function migrateTenants(opts: MigrateTenantsOptions): Promise<MigrateTenantsResult> {
  const { tenants, adapterFor, concurrency = 1, stopOnError = false, onTenant, ...runner } = opts
  const queue = [...(typeof tenants === 'function' ? await tenants() : tenants)]
  const results: TenantMigrationResult[] = []
  let stop = false

  const migrateOne = async (tenant: string) => {
    let result: TenantMigrationResult
    let adapter: MigrationAdapter | undefined
    try {
      adapter = await adapterFor(tenant)
      result = { tenant, summary: await migrateLatest({ ...runner, adapter }) }
    } catch (error) {
      result = { tenant, error }
      if (stopOnError) stop = true
    } finally {
      await adapter?.close().catch(() => {})
    }
    results.push(result)
    onTenant?.(result)
  }

  const worker = async () => {
    for (;;) {
      // `stop` is set by another worker's failure (stopOnError).
      const tenant = stop ? undefined : queue.shift()
      if (tenant === undefined) return
      await migrateOne(tenant)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker))
  return { results, failed: results.filter((r) => r.error !== undefined).map((r) => r.tenant) }
}
