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
