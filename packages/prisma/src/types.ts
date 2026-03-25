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
