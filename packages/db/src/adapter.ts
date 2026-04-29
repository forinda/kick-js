import { defineAdapter } from '@forinda/kickjs'
import type { InjectionToken } from '@forinda/kickjs'

import { migrateLatest, migrateStatus } from './migrate/runner'
import type { MigrationAdapter } from './migrate/adapter'
import type { DriftBehavior } from './migrate/drift'

export type MigrationsOnBoot = 'fail-if-pending' | 'apply' | 'ignore'

export interface KickDbAdapterConfig {
  /** The driver-bound MigrationAdapter — pgAdapter() in @forinda/kickjs-db-pg, etc. */
  migrationAdapter: MigrationAdapter
  /** Directory containing the generated migrations + _journal.json. */
  migrationsDir: string
  /** Boot policy. Default 'fail-if-pending' — mirror the operator-explicit philosophy. */
  migrationsOnBoot?: MigrationsOnBoot
  /** Drift detection mode. Default 'error' outside dev. */
  driftCheck?: DriftBehavior
  /** Default true outside dev. */
  requireReviewed?: boolean
  /** Optional DI token to register the migrationAdapter under, for adopters who need direct access. */
  token?: InjectionToken<MigrationAdapter>
  /**
   * Optional KickEventBus the adapter publishes migration events to.
   * When set, `db:migration-applied` fires after a successful
   * `migrateLatest()` on boot (apply policy only). Pair with
   * `DEVTOOLS_BUS` so the events surface in the DevTools panel:
   *
   *   import { DEVTOOLS_BUS } from '@forinda/kickjs-devtools-kit/bus'
   *   // Resolve only when devtools is actually wired — adopters who
   *   // skip @forinda/kickjs-devtools never register the token, and
   *   // resolve() throws on missing tokens.
   *   const adapter = kickDbAdapter({
   *     ...,
   *     bus: container.has(DEVTOOLS_BUS) ? container.resolve(DEVTOOLS_BUS) : undefined,
   *   })
   *
   * Type imported via `import type` so kickjs-db keeps devtools-kit
   * as an optional peer.
   */
  bus?: import('@forinda/kickjs-devtools-kit/bus').KickEventBus
}

/**
 * KickJS lifecycle adapter for kickjs-db. Three jobs:
 *
 *  1. On boot, decide what to do about pending migrations per `migrationsOnBoot`.
 *     - 'fail-if-pending' (default): throw if any pending exists. Operators
 *       run `kick db migrate latest` explicitly before deploys land. Avoids
 *       the prisma footgun where migrations silently apply on deploy.
 *     - 'apply': run migrateLatest() automatically. Useful for dev / preview
 *       environments where convenience matters more than safety.
 *     - 'ignore': boot regardless. Last-resort escape hatch.
 *  2. On shutdown, close the migrationAdapter (drains the pool, etc).
 *  3. Register the migrationAdapter under an optional DI token so adopters
 *     can pull it for ad-hoc tooling. The KickDbClient (Task 19b) registers
 *     separately under DB_PRIMARY.
 */
export const kickDbAdapter = defineAdapter<KickDbAdapterConfig>({
  name: 'kickjs-db',
  build: (config) => ({
    async beforeStart({ container }) {
      const policy = config.migrationsOnBoot ?? 'fail-if-pending'
      const status = await migrateStatus({
        adapter: config.migrationAdapter,
        migrationsDir: config.migrationsDir,
      })
      const pending = status.filter((s) => s.state === 'pending')

      if (pending.length > 0) {
        if (policy === 'fail-if-pending') {
          throw new Error(
            `kickjs-db: ${pending.length} pending migration(s); run \`kick db migrate latest\` before boot`,
          )
        }
        if (policy === 'apply') {
          const result = await migrateLatest({
            adapter: config.migrationAdapter,
            migrationsDir: config.migrationsDir,
            requireReviewed: config.requireReviewed,
            driftCheck: config.driftCheck,
          })
          // Republish to DevTools when a bus is wired so the panel
          // can surface "migrations ran on boot" without polling.
          // `applied` is the list of migration ids the runner ran;
          // `batch` is the batch number the journal stamped them with.
          if (config.bus) {
            config.bus.emit('db:migration-applied', {
              applied: result.applied,
              batch: result.batch,
            })
          }
        }
        // 'ignore' falls through.
      }

      if (config.token) {
        container.registerFactory(config.token, () => config.migrationAdapter)
      }
    },
    async shutdown() {
      await config.migrationAdapter.close()
    },
  }),
})
