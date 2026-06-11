/**
 * @deprecated `@forinda/kickjs-drizzle` is deprecated — the DB layer is
 * consolidated into `@forinda/kickjs-db`. Migrate to the unified schema
 * DSL + client (`@forinda/kickjs-db`, dialect subpaths `/pg`, `/mysql`,
 * `/sqlite`). This package will be removed in a future major.
 *
 * @module @forinda/kickjs-drizzle
 */
import { warnDeprecated } from './deprecation'

warnDeprecated()

export { DrizzleAdapter } from './drizzle.adapter'
export { DrizzleTenantAdapter } from './drizzle-tenant.adapter'
export { DrizzleQueryAdapter, toQueryFieldConfig } from './query-adapter'
export { DRIZZLE_DB, DRIZZLE_TENANT_DB } from './types'
export type { DrizzleAdapterOptions, DrizzleTenantAdapterOptions } from './types'
export type {
  DrizzleQueryConfig,
  DrizzleColumnQueryConfig,
  DrizzleQueryParamsConfig,
  DrizzleQueryResult,
  DrizzleOps,
} from './query-adapter'
