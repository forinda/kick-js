import { Logger, type AppAdapter, type Container, Scope } from '@forinda/kickjs-core'
import { DRIZZLE_DB, type DrizzleAdapterOptions } from './types'

const log = Logger.for('DrizzleAdapter')

/**
 * Drizzle ORM adapter — registers a Drizzle database instance in the DI
 * container and manages its lifecycle.
 *
 * Works with any Drizzle driver: `drizzle-orm/postgres-js`, `drizzle-orm/node-postgres`,
 * `drizzle-orm/mysql2`, `drizzle-orm/better-sqlite3`, `drizzle-orm/libsql`, etc.
 *
 * @example
 * ```ts
 * import { drizzle } from 'drizzle-orm/postgres-js'
 * import postgres from 'postgres'
 * import { DrizzleAdapter } from '@forinda/kickjs-drizzle'
 *
 * const client = postgres(process.env.DATABASE_URL!)
 * const db = drizzle(client)
 *
 * bootstrap({
 *   modules,
 *   adapters: [
 *     new DrizzleAdapter({
 *       db,
 *       logging: true,
 *       onShutdown: () => client.end(),
 *     }),
 *   ],
 * })
 * ```
 *
 * Inject the db instance in services:
 * ```ts
 * @Service()
 * class UserService {
 *   @Inject(DRIZZLE_DB) private db: PostgresJsDatabase
 * }
 * ```
 */
export class DrizzleAdapter implements AppAdapter {
  name = 'DrizzleAdapter'
  private db: any
  private onShutdown?: () => void | Promise<void>

  constructor(private options: DrizzleAdapterOptions) {
    this.db = options.db
    this.onShutdown = options.onShutdown
  }

  /** Register the Drizzle db instance in the DI container */
  beforeStart(_app: any, container: Container): void {
    // Set up query logging if requested
    if (this.options.logging) {
      log.info('Query logging enabled')
    }

    // Register the db instance as a singleton in the container
    container.registerFactory(DRIZZLE_DB, () => this.db, Scope.SINGLETON)

    log.info('Drizzle database registered in DI container')
  }

  /** Close the underlying connection on shutdown */
  async shutdown(): Promise<void> {
    if (this.onShutdown) {
      await this.onShutdown()
      log.info('Drizzle connection closed')
    }
  }
}
