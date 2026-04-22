import { Logger, defineAdapter, Scope } from '@forinda/kickjs'
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
 * PrismaAdapter({ client: new PrismaClient(), logging: true })
 * ```
 *
 * @example Prisma 7+ (driver adapters)
 * ```ts
 * import { PrismaClient } from './generated/prisma'
 * import { PrismaPg } from '@prisma/adapter-pg'
 * import pg from 'pg'
 *
 * const pool = new pg.Pool({ connectionString: getEnv('DATABASE_URL') })
 * const client = new PrismaClient({ adapter: new PrismaPg(pool) })
 * PrismaAdapter({ client, logging: true })
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
export const PrismaAdapter = defineAdapter<PrismaAdapterOptions>({
  name: 'PrismaAdapter',
  build: (options) => {
    let client = options.client

    return {
      beforeStart({ container }) {
        // Set up query logging if requested
        if (options.logging) {
          if (typeof client.$on === 'function') {
            // Prisma 5/6: event-based logging
            client.$on('query', (event: any) => {
              log.debug(`Query: ${event.query}`)
              log.debug(`Params: ${event.params}`)
              log.debug(`Duration: ${event.duration}ms`)
            })
          } else if (typeof client.$extends === 'function') {
            // Prisma 7+: Client Extensions for logging ($on removed)
            client = client.$extends({
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
        container.registerFactory(PRISMA_CLIENT, () => client, Scope.SINGLETON)

        log.info('PrismaClient registered in DI container')
      },

      async shutdown() {
        if (typeof client.$disconnect === 'function') {
          await client.$disconnect()
          log.info('PrismaClient disconnected')
        }
      },
    }
  },
})
