import { Logger, type AppAdapter, type Container, Scope } from '@forinda/kickjs-core'
import { PRISMA_CLIENT, type PrismaAdapterOptions } from './types'

const log = Logger.for('PrismaAdapter')

/**
 * Prisma adapter — registers a PrismaClient in the DI container and manages
 * its lifecycle (connection setup and teardown).
 *
 * @example
 * ```ts
 * import { PrismaClient } from '@prisma/client'
 * import { PrismaAdapter } from '@forinda/kickjs-prisma'
 *
 * bootstrap({
 *   modules,
 *   adapters: [
 *     new PrismaAdapter({ client: new PrismaClient(), logging: true }),
 *   ],
 * })
 * ```
 *
 * Inject the client in services:
 * ```ts
 * @Service()
 * class UserService {
 *   @Inject(PRISMA_CLIENT) private prisma: PrismaClient
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
    if (this.options.logging && typeof this.client.$on === 'function') {
      this.client.$on('query', (event: any) => {
        log.debug(`Query: ${event.query}`)
        log.debug(`Params: ${event.params}`)
        log.debug(`Duration: ${event.duration}ms`)
      })
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
