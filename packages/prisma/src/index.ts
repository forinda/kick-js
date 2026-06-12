/**
 * @deprecated `@forinda/kickjs-prisma` is deprecated. It was an
 * early-adoption adapter and is no longer maintained — wire Prisma
 * directly in your app (BYO), or use `@forinda/kickjs-db`, the
 * built-in Kick ORM, if you prefer to skip external ORMs. This
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
