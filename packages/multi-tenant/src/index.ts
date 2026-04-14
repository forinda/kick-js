export { TenantAdapter } from './tenant.adapter'
export { TENANT_CONTEXT } from './types'
export type { TenantInfo, MultiTenantOptions, TenantResolutionStrategy } from './types'
export { getCurrentTenant } from './tenant.context'
export { TENANT_DB } from './database'
export type {
  TenantDatabase,
  DatabasePerTenantConfig,
  SchemaPerTenantConfig,
  DiscriminatorConfig,
  DatabaseConnectionInfo,
} from './database'
