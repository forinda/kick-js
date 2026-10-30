/**
 * One `Storage` for the whole app, injectable anywhere:
 *
 * ```ts
 * import { STORAGE, StorageAdapter } from '@forinda/kickjs-storage/adapter'
 *
 * bootstrap({ modules, adapters: [StorageAdapter({ storage: s3FromSettings() })] })
 *
 * @Service()
 * class Avatars {
 *   @Autowired(STORAGE) private files!: Storage
 * }
 * ```
 *
 * A storage from `s3FromSettings()` also brings its settings section, so a
 * missing `S3_BUCKET` stops startup. A second storage binds its own token:
 * `StorageAdapter.scoped('backups', { storage, token: BACKUPS })`.
 *
 * @module @forinda/kickjs-storage/adapter
 */
import {
  createToken,
  defineAdapter,
  type InjectionToken,
  type SettingsDeclaration,
} from '@forinda/kickjs'
import type { Storage } from './types'

/** The app's storage, bound by {@link StorageAdapter}. */
export const STORAGE = createToken<Storage>('kick/storage/default')

// Set by s3FromSettings: the section a storage reads, for the adapter to declare.
const SETTINGS = Symbol.for('kickjs-storage.settings')

export interface StorageAdapterOptions {
  storage: Storage
  /** The token to bind. Default {@link STORAGE}. */
  token?: InjectionToken<Storage>
  /**
   * `false` reports `up` to `/health/ready` without checking. Default `true`: the
   * check lists one key, which on S3 needs list permission on the bucket.
   */
  healthCheck?: boolean
  /**
   * More sections to declare beside the storage's own — for a bucket the app
   * only uses sometimes, `[S3Settings.optional()]`, so `kick env example`
   * lists its variables while the app runs on disk.
   */
  settings?: readonly SettingsDeclaration[]
}

export const StorageAdapter = defineAdapter<StorageAdapterOptions>({
  name: 'StorageAdapter',
  build: (config, { name }) => ({
    settings: () => {
      const section = (config.storage as unknown as Record<symbol, unknown>)[SETTINGS]
      return [...(section ? [section as never] : []), ...(config.settings ?? [])]
    },
    beforeStart({ container }) {
      container.registerInstance(config.token ?? STORAGE, config.storage)
    },
    /** `/health/ready`: list one key — a round trip to the bucket or directory. */
    async onHealthCheck() {
      if (config.healthCheck !== false) await config.storage.list({ limit: 1 })
      return { name, status: 'up' as const }
    },
  }),
})
