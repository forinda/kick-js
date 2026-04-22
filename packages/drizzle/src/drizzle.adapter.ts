import { Logger, defineAdapter, Scope } from '@forinda/kickjs'
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
 * import { drizzle } from 'drizzle-orm/better-sqlite3'
 * import * as schema from './schema'
 * import { DrizzleAdapter } from '@forinda/kickjs-drizzle'
 *
 * const db = drizzle({ client: sqlite, schema })
 *
 * bootstrap({
 *   modules,
 *   adapters: [
 *     DrizzleAdapter({ db, onShutdown: () => sqlite.close() }),
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
export const DrizzleAdapter = defineAdapter<DrizzleAdapterOptions<unknown>>({
  name: 'DrizzleAdapter',
  build: (options) => {
    const db = options.db
    const onShutdown = options.onShutdown

    return {
      beforeStart({ container }) {
        if (options.logging) {
          log.info('Query logging enabled')
        }

        container.registerFactory(DRIZZLE_DB, () => db, Scope.SINGLETON)

        log.info('Drizzle database registered in DI container')
      },

      async shutdown() {
        if (onShutdown) {
          await onShutdown()
          log.info('Drizzle connection closed')
        }
      },
    }
  },
})
