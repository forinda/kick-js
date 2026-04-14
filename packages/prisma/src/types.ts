import type { MaybePromise } from '@forinda/kickjs'

/** DI token for resolving the current tenant's PrismaClient (multi-tenant) */
export const PRISMA_TENANT_CLIENT = Symbol('PrismaTenantDB')

export interface PrismaTenantAdapterOptions<TDb = unknown> {
  /**
   * The provider (default) PrismaClient. Used when no tenant is
   * resolved or when accessing the tenant registry.
   */
  providerDb: TDb

  /**
   * Factory that creates a PrismaClient for a given tenant.
   * Called once per tenant — the result is cached for subsequent requests.
   *
   * @example
   * ```ts
   * tenantFactory: async (tenantId) => {
   *   const url = await lookupTenantDbUrl(tenantId)
   *   return new PrismaClient({ datasourceUrl: url })
   * }
   * ```
   */
  tenantFactory: (tenantId: string) => TDb | Promise<TDb>

  /**
   * Optional function to close a tenant PrismaClient connection.
   * Called for each cached connection during shutdown.
   */
  onTenantShutdown?: (db: TDb, tenantId: string) => MaybePromise<any>

  /** Enable query logging (default: false) */
  logging?: boolean

  /**
   * Cache TTL in milliseconds. Tenant connections idle beyond this
   * duration are evicted. Default: no eviction (connections live until shutdown).
   */
  cacheTtl?: number
}

export interface PrismaAdapterOptions {
  /**
   * PrismaClient instance — typed as `any` to avoid version coupling.
   *
   * Prisma 5/6: `new PrismaClient()` from `@prisma/client`
   * Prisma 7+:  `new PrismaClient({ adapter })` from your generated output path
   */
  client: any
  /**
   * Enable query logging (default: false).
   * Uses `$on('query', ...)` for Prisma 5/6 and `$extends` for Prisma 7+.
   */
  logging?: boolean
}

/** DI token for resolving the PrismaClient from the container */
export const PRISMA_CLIENT = Symbol('PrismaClient')

/**
 * Common Prisma model delegate operations.
 * Use this to type-narrow the injected PrismaClient to a specific model
 * without needing `as any` casts in repositories.
 *
 * @example
 * ```ts
 * @Repository()
 * export class PrismaUserRepository {
 *   @Inject(PRISMA_CLIENT) private prisma!: { user: PrismaModelDelegate }
 *
 *   async findById(id: string) {
 *     return this.prisma.user.findUnique({ where: { id } })
 *   }
 * }
 * ```
 */
export interface PrismaModelDelegate {
  findUnique(args: {
    where: Record<string, unknown>
    include?: Record<string, unknown>
  }): Promise<unknown>
  findFirst?(args?: Record<string, unknown>): Promise<unknown>
  findMany(args?: Record<string, unknown>): Promise<unknown[]>
  create(args: { data: Record<string, unknown> }): Promise<unknown>
  update(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<unknown>
  delete(args: { where: Record<string, unknown> }): Promise<unknown>
  deleteMany(args?: { where?: Record<string, unknown> }): Promise<{ count: number }>
  count(args?: { where?: Record<string, unknown> }): Promise<number>
}
