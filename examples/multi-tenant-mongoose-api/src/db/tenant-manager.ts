import { PROVIDER_TENANT, providerTenants, type TenantRecord } from './schema'

/**
 * Type-safe tenant connection manager.
 *
 * In a real Mongoose app, TDb would be `mongoose.Connection`.
 * This example uses a simulated DB interface to avoid requiring a
 * running MongoDB instance.
 *
 * Pattern:
 *   1. First request for a tenant calls the factory to create a connection
 *   2. Connection is cached in the map for subsequent requests
 *   3. `getDb()` returns a fully typed instance
 *
 * In production, TDb = mongoose.Connection. Use
 *   `mongoose.createConnection(uri + '/tenant_' + tenantId)`.
 * Models are scoped to a connection — use
 *   `conn.model('User', userSchema)` per tenant.
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

    return this.connections.get(key)
  }

  async closeAll(closeFn: (db: TDb) => Promise<void>): Promise<void> {
    for (const db of this.connections.values()) {
      await closeFn(db)
    }
    this.connections.clear()
  }
}

// ── Simulated Mongoose-like DB ───────────────────────────────────────
//
// In production, replace SimulatedDb with:
//   import mongoose from 'mongoose'
//   export type TenantDb = mongoose.Connection
//
// Factory becomes:
//   (tenantId) => mongoose.createConnection(`mongodb://localhost:27017/tenant_${tenantId}`)
//
// Then register models per connection:
//   const UserModel = conn.model('User', userSchema)
//   const ProjectModel = conn.model('Project', projectSchema)

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
