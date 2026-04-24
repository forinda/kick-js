/**
 * Per-tenant database switching configuration.
 *
 * Three isolation modes, from strongest to weakest:
 * - `database` — each tenant has its own database
 * - `schema` — shared database, separate schemas (PostgreSQL)
 * - `discriminator` — shared tables with a tenant_id column
 */

import { createToken } from '@forinda/kickjs'

export interface DatabaseConnectionInfo {
  host: string
  port?: number
  database: string
  user: string
  password: string
}

export interface DatabasePerTenantConfig {
  mode: 'database'
  /** Resolve connection info for a tenant */
  resolve: (tenantId: string) => DatabaseConnectionInfo | Promise<DatabaseConnectionInfo>
  /** Connection pool settings */
  pool?: { min?: number; max?: number; idleTimeout?: number }
  /** Cache resolved connections (default TTL: 300_000ms = 5 min) */
  cache?: { ttl?: number }
}

export interface SchemaPerTenantConfig {
  mode: 'schema'
  /** Base connection URL (shared database) */
  connection: string
  /** Schema name template. `${tenantId}` is replaced at runtime. Default: `'tenant_${tenantId}'` */
  schemaTemplate?: string
}

export interface DiscriminatorConfig {
  mode: 'discriminator'
  /** Base connection URL (shared everything) */
  connection: string
  /** Column name used to scope queries. Default: `'tenant_id'` */
  column?: string
}

export type TenantDatabase = DatabasePerTenantConfig | SchemaPerTenantConfig | DiscriminatorConfig

/**
 * DI token for the current tenant's database connection.
 *
 * Typed as `unknown` because the concrete database type depends on the
 * adopter's ORM (Drizzle, Prisma, raw client, …); cast at the use site:
 *
 * @example
 * ```ts
 * @Service()
 * class UserRepo {
 *   constructor(@Inject(TENANT_DB) private db: NodePgDatabase<typeof schema>) {}
 * }
 * ```
 */
export const TENANT_DB = createToken<unknown>('kick/multi-tenant/db')
