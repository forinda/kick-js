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
          await migrateLatest({
            adapter: config.migrationAdapter,
            migrationsDir: config.migrationsDir,
            requireReviewed: config.requireReviewed,
            driftCheck: config.driftCheck,
          })
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
