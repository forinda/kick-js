import 'reflect-metadata'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Application, Container, createToken } from '@forinda/kickjs'
import { memoryStorage, type Storage } from '../src/index'
import { STORAGE, StorageAdapter } from '../src/adapter'
import { s3FromSettings } from '../src/settings'

beforeEach(() => Container.reset())
afterEach(() => vi.unstubAllEnvs())

it('binds the storage to STORAGE', async () => {
  const files = memoryStorage()
  const app = new Application({ modules: [], adapters: [StorageAdapter({ storage: files })] })
  await app.setup()
  expect(Container.getInstance().resolve(STORAGE)).toBe(files)
})

it('binds a second storage to its own token', async () => {
  const BACKUPS = createToken<Storage>('app/storage/backups')
  const [main, backups] = [memoryStorage(), memoryStorage()]
  const app = new Application({
    modules: [],
    adapters: [
      StorageAdapter({ storage: main }),
      StorageAdapter.scoped('backups', { storage: backups, token: BACKUPS }),
    ],
  })
  await app.setup()
  expect(Container.getInstance().resolve(STORAGE)).toBe(main)
  expect(Container.getInstance().resolve(BACKUPS)).toBe(backups)
})

it("declares s3FromSettings' section, so missing variables stop startup", async () => {
  for (const name of ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) vi.stubEnv(name, '')
  const app = new Application({
    modules: [],
    adapters: [StorageAdapter({ storage: s3FromSettings() })],
  })
  await expect(app.setup()).rejects.toThrow(/S3_BUCKET/)
  const section = app.describeConfig().sections.find((s) => s.prefix === 'S3')
  expect(section?.declaredBy).toBe('adapter StorageAdapter')
})

it('reports the storage in /health/ready: down when listing it fails', async () => {
  const files = memoryStorage()
  const adapter = StorageAdapter({ storage: files })
  expect(await adapter.onHealthCheck!()).toEqual({ name: 'StorageAdapter', status: 'up' })
  vi.spyOn(files, 'list').mockRejectedValue(new Error('AccessDenied'))
  expect(await adapter.onHealthCheck!()).toEqual({ name: 'StorageAdapter', status: 'down' })
})
