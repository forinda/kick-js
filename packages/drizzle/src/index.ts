/**
 * @deprecated `@forinda/kickjs-drizzle` is deprecated. It was an
 * early-adoption adapter and is no longer maintained —
 * `@forinda/kickjs-db` (schema DSL + client, dialect subpaths `/pg`,
 * `/mysql`, `/sqlite`) is the supported DB layer going forward. This
 * package will be removed in a future major.
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
