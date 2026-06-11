/**
 * @deprecated `@forinda/kickjs-prisma` is deprecated. It was an
 * early-adoption adapter and is no longer maintained —
 * `@forinda/kickjs-db` (schema DSL + client, dialect subpaths `/pg`,
 * `/mysql`, `/sqlite`) is the supported DB layer going forward. This
 * package will be removed in a future major.
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
