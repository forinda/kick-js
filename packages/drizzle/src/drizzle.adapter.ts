import { Logger, type AppAdapter, type AdapterContext, Scope } from '@forinda/kickjs-core'
import { DRIZZLE_DB, type DrizzleAdapterOptions } from './types'

const log = Logger.for('DrizzleAdapter')

/**
 * Drizzle ORM adapter — registers a Drizzle database instance in the DI
 * container and manages its lifecycle.
 *
 * Works with any Drizzle driver: `drizzle-orm/postgres-js`, `drizzle-orm/node-postgres`,
 * `drizzle-orm/mysql2`, `drizzle-orm/better-sqlite3`, `drizzle-orm/libsql`, etc.
 *
 * The adapter is generic — the db type is inferred from what you pass in,
 * so services can inject the fully-typed database instance.
 *
 * @example
 * ```ts
 * import { drizzle } from 'drizzle-orm/better-sqlite3'
 * import * as schema from './schema'
 * import { DrizzleAdapter } from '@forinda/kickjs-drizzle'
 *
 * const db = drizzle({ client: sqlite, schema })
 *
 * bootstrap({
 *   modules,
 *   adapters: [
 *     new DrizzleAdapter({ db, onShutdown: () => sqlite.close() }),
 *   ],
 * })
 * ```
 *
 * Inject the typed db instance in services:
 * ```ts
 * import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
 * import * as schema from './schema'
 *
 * @Service()
 * class UserService {
 *   constructor(@Inject(DRIZZLE_DB) private db: BetterSQLite3Database<typeof schema>) {}
 * }
 * ```
 */
export class DrizzleAdapter<TDb = unknown> implements AppAdapter {
  name = 'DrizzleAdapter'
  private db: TDb
  private onShutdown?: () => void | Promise<void>

  constructor(private options: DrizzleAdapterOptions<TDb>) {
    this.db = options.db
    this.onShutdown = options.onShutdown
  }

  /** Register the Drizzle db instance in the DI container */
  beforeStart({ container }: AdapterContext): void {
    if (this.options.logging) {
      log.info('Query logging enabled')
    }

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
