/** DI token for the current tenant context */
export const TENANT_CONTEXT = Symbol('TenantContext')

/** Tenant information resolved from the request */
export interface TenantInfo {
  /** Unique tenant identifier */
  id: string
  /** Optional tenant name */
  name?: string
  /** Optional tenant-specific config/metadata */
  metadata?: Record<string, any>
}

/** Strategy for resolving the tenant from a request */
export type TenantResolutionStrategy =
  | 'header'
  | 'subdomain'
  | 'path'
  | 'query'
  | ((req: any) => TenantInfo | null | Promise<TenantInfo | null>)

export interface MultiTenantOptions {
  /**
   * How to resolve the tenant from the request.
   * - 'header' — reads X-Tenant-ID header (default)
   * - 'subdomain' — extracts from subdomain (tenant.example.com)
   * - 'path' — extracts from first path segment (/tenant-id/...)
   * - 'query' — reads ?tenantId= query param
   * - function — custom resolver
   */
  strategy?: TenantResolutionStrategy

  /** Header name when strategy is 'header' (default: 'x-tenant-id') */
  headerName?: string

  /** Query param name when strategy is 'query' (default: 'tenantId') */
  queryParam?: string

  /**
   * Called after tenant is resolved. Use for validation, loading tenant
   * config from DB, or rejecting unknown tenants.
   */
  onTenantResolved?: (tenant: TenantInfo, req: any) => void | Promise<void>

  /** Return a 403 if no tenant can be resolved (default: true) */
  required?: boolean

  /** Routes to skip tenant resolution (e.g., health checks) */
  excludeRoutes?: string[]

  /**
   * Per-tenant database switching configuration.
   * When set, a TENANT_DB DI token is registered that resolves to
   * the current tenant's database connection.
   */
  database?: import('./database').TenantDatabase
}
