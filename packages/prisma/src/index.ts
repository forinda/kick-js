/**
 * @deprecated `@forinda/kickjs-prisma` is deprecated — the DB layer is
 * consolidated into `@forinda/kickjs-db`. Migrate to the unified schema
 * DSL + client (`@forinda/kickjs-db`, dialect subpaths `/pg`, `/mysql`,
 * `/sqlite`). This package will be removed in a future major.
 *
 * @module @forinda/kickjs-prisma
 */
import { warnDeprecated } from './deprecation'

warnDeprecated()

export { PrismaAdapter } from './prisma.adapter'
export { PrismaTenantAdapter } from './prisma-tenant.adapter'
export { PrismaQueryAdapter } from './query-adapter'
export { PRISMA_CLIENT, PRISMA_TENANT_CLIENT } from './types'
export type { PrismaAdapterOptions, PrismaModelDelegate, PrismaTenantAdapterOptions } from './types'
export type { PrismaQueryConfig, PrismaQueryResult } from './query-adapter'
