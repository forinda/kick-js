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
 * `/health/ready` lists one page of at most one file from the storage: a
 * bucket that's unreachable or refuses the credentials reports `down`.
 *
 * @module @forinda/kickjs-storage/adapter
 */
import { createToken, defineAdapter, type InjectionToken } from '@forinda/kickjs'
import type { Storage } from './types'

/** The app's storage, bound by {@link StorageAdapter}. */
export const STORAGE = createToken<Storage>('kick/storage/default')

// Set by s3FromSettings: the section a storage reads, for the adapter to declare.
const SETTINGS = Symbol.for('kickjs-storage.settings')

export interface StorageAdapterOptions {
  storage: Storage
  /** The token to bind. Default {@link STORAGE}. */
  token?: InjectionToken<Storage>
}

export const StorageAdapter = defineAdapter<StorageAdapterOptions>({
  name: 'StorageAdapter',
  build: (config, { name }) => ({
    settings: () => {
      const section = (config.storage as unknown as Record<symbol, unknown>)[SETTINGS]
      return section ? [section as never] : []
    },
    beforeStart({ container }) {
      container.registerInstance(config.token ?? STORAGE, config.storage)
    },
    async onHealthCheck() {
      try {
        await config.storage.list({ limit: 1 })
        return { name, status: 'up' as const }
      } catch {
        return { name, status: 'down' as const }
      }
    },
  }),
})
