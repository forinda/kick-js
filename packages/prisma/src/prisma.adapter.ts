import { Logger, type AppAdapter, type Container, Scope } from '@forinda/kickjs-core'
import { PRISMA_CLIENT, type PrismaAdapterOptions } from './types'

const log = Logger.for('PrismaAdapter')

/**
 * Prisma adapter — registers a PrismaClient in the DI container and manages
 * its lifecycle (connection setup and teardown).
 *
 * Works with Prisma 5, 6, and 7+.
 *
 * @example Prisma 5/6
 * ```ts
 * import { PrismaClient } from '@prisma/client'
 *
 * new PrismaAdapter({ client: new PrismaClient(), logging: true })
 * ```
 *
 * @example Prisma 7+ (driver adapters)
 * ```ts
 * import { PrismaClient } from './generated/prisma'
 * import { PrismaPg } from '@prisma/adapter-pg'
 * import pg from 'pg'
 *
 * const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
 * const client = new PrismaClient({ adapter: new PrismaPg(pool) })
 * new PrismaAdapter({ client, logging: true })
 * ```
 *
 * Inject the client in services:
 * ```ts
 * @Service()
 * class UserService {
 *   @Inject(PRISMA_CLIENT) private prisma!: PrismaClient
 * }
 * ```
 */
export class PrismaAdapter implements AppAdapter {
  name = 'PrismaAdapter'
  private client: any

  constructor(private options: PrismaAdapterOptions) {
    this.client = options.client
  }

  /** Register the PrismaClient in the DI container */
  beforeStart(_app: any, container: Container): void {
    // Set up query logging if requested
    if (this.options.logging) {
      if (typeof this.client.$on === 'function') {
        // Prisma 5/6: event-based logging
        this.client.$on('query', (event: any) => {
          log.debug(`Query: ${event.query}`)
          log.debug(`Params: ${event.params}`)
          log.debug(`Duration: ${event.duration}ms`)
        })
      } else if (typeof this.client.$extends === 'function') {
        // Prisma 7+: Client Extensions for logging ($on removed)
        this.client = this.client.$extends({
          query: {
            $allOperations({ operation, model, args, query }: any) {
              const start = performance.now()
              return query(args).then((result: any) => {
                const duration = Math.round(performance.now() - start)
                log.debug(`${model}.${operation} — ${duration}ms`)
                return result
              })
            },
          },
        })
      }
    }

    // Register the client instance as a singleton factory in the container
    container.registerFactory(PRISMA_CLIENT, () => this.client, Scope.SINGLETON)

    log.info('PrismaClient registered in DI container')
  }

  /** Disconnect the PrismaClient on shutdown */
  async shutdown(): Promise<void> {
    if (typeof this.client.$disconnect === 'function') {
      await this.client.$disconnect()
      log.info('PrismaClient disconnected')
    }
  }
}
