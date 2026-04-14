import { PROVIDER_TENANT, providerTenants, type TenantRecord } from './schema'

/**
 * Type-safe tenant connection manager.
 *
 * In a real Drizzle app, TDb would be `NodePgDatabase<typeof schema>`.
 * This example uses a simulated DB interface to avoid requiring a
 * running PostgreSQL instance.
 *
 * Pattern:
 *   1. First request for a tenant calls the factory to create a connection
 *   2. Connection is cached in the map for subsequent requests
 *   3. `getDb()` returns a fully typed instance
 */
export class TenantConnectionManager<TDb> {
  private readonly connections = new Map<string, TDb>()

  constructor(
    private readonly factory: (tenantId: string) => TDb | Promise<TDb>,
    private readonly defaultTenantId: string = PROVIDER_TENANT,
  ) {}

  async getDb(tenantId?: string): Promise<TDb> {
    const key = tenantId ?? this.defaultTenantId

    if (!this.connections.has(key)) {
      const db = await this.factory(key)
      this.connections.set(key, db)
    }

    return this.connections.get(key)!
  }

  async closeAll(closeFn: (db: TDb) => Promise<void>): Promise<void> {
    for (const db of this.connections.values()) {
      await closeFn(db)
    }
    this.connections.clear()
  }
}

// ── Simulated Drizzle-like DB ─────────────────────────────────────────
//
// In production, replace SimulatedDb with:
//   import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
//   import { Pool } from 'pg'
//   import * as schema from './schema'
//   export type TenantDb = NodePgDatabase<typeof schema>

export interface SimulatedDb {
  tenantId: string
  query: (table: string) => { tenantId: string; table: string; rows: any[] }
}

function createSimulatedDb(tenantId: string): SimulatedDb {
  return {
    tenantId,
    query: (table: string) => ({
      tenantId,
      table,
      rows: [{ id: '1', note: `Sample ${table} row for ${tenantId}` }],
    }),
  }
}

// ── Tenant Manager Instance ───────────────────────────────────────────

export const tenantManager = new TenantConnectionManager<SimulatedDb>(
  (tenantId) => createSimulatedDb(tenantId),
)

// ── Helpers ───────────────────────────────────────────────────────────

/** Look up a tenant record from the provider registry by subdomain. */
export function findTenantBySubdomain(subdomain: string): TenantRecord | undefined {
  return providerTenants.find((t) => t.subdomain === subdomain)
}

/** Look up a tenant record by ID. */
export function findTenantById(id: string): TenantRecord | undefined {
  return providerTenants.find((t) => t.id === id)
}
