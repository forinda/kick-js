export interface PrismaAdapterOptions {
  /** PrismaClient instance - typed as `any` to avoid version coupling */
  client: any
  /** Enable query logging (default: false) */
  logging?: boolean
}

/** DI token for resolving the PrismaClient from the container */
export const PRISMA_CLIENT = Symbol('PrismaClient')
