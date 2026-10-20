import 'reflect-metadata'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Application, Container } from '@forinda/kickjs'
import { S3Settings, s3FromSettings } from '../src/settings'

beforeEach(() => Container.reset())
afterEach(() => vi.unstubAllEnvs())

it('reads nothing until first use, then the value the app bound', async () => {
  const urls: string[] = []
  const fetch = (async (url: URL) => {
    urls.push(String(url))
    return new Response(null, { status: 404 })
  }) as unknown as typeof globalThis.fetch
  // No S3_* env at all: building the storage must not throw.
  const files = s3FromSettings(S3Settings, { fetch })
  const app = new Application({
    modules: [],
    settings: [
      S3Settings.provide({
        bucket: 'b',
        endpoint: 'http://minio.test',
        accessKeyId: 'id',
        secretAccessKey: 'secret',
      }),
    ],
  })
  await app.setup()
  expect(await files.exists('k')).toBe(false)
  expect(urls).toEqual(['http://minio.test/b/k'])
})

it('fails startup naming every missing variable', async () => {
  vi.stubEnv('S3_BUCKET', '')
  vi.stubEnv('S3_ACCESS_KEY_ID', 'id')
  vi.stubEnv('S3_SECRET_ACCESS_KEY', '')
  vi.stubEnv('S3_ENDPOINT', 'not a url')
  const app = new Application({ modules: [], settings: [S3Settings] })
  await expect(app.setup()).rejects.toThrow(
    /S3_BUCKET[\s\S]*S3_ENDPOINT[\s\S]*S3_SECRET_ACCESS_KEY/,
  )
})

it('takes no keys at all, signing with a credentials provider', async () => {
  const auth: string[] = []
  const fetch = (async (_url: string, init: RequestInit) => {
    auth.push(new Headers(init.headers).get('authorization')!)
    return new Response(null, { status: 404 })
  }) as unknown as typeof globalThis.fetch
  const files = s3FromSettings(S3Settings, {
    fetch,
    credentials: () => ({ accessKeyId: 'role', secretAccessKey: 's' }),
  })
  const app = new Application({
    modules: [],
    settings: [S3Settings.provide({ bucket: 'b', endpoint: 'http://minio.test' })],
  })
  await app.setup()
  expect(await files.exists('k')).toBe(false)
  expect(auth[0]).toContain('Credential=role/')
})

it('reads a second bucket under its own prefix', () => {
  const r2 = S3Settings.scoped('R2')
  expect(r2.envNames).toEqual([
    'R2_S3_BUCKET',
    'R2_S3_ACCESS_KEY_ID',
    'R2_S3_SECRET_ACCESS_KEY',
    'R2_S3_REGION',
    'R2_S3_ENDPOINT',
    'R2_S3_SESSION_TOKEN',
    'R2_S3_FORCE_PATH_STYLE',
  ])
})

it('reads S3_FORCE_PATH_STYLE as a boolean', () => {
  expect(
    S3Settings.parse({
      bucket: 'b',
      accessKeyId: 'i',
      secretAccessKey: 's',
      forcePathStyle: 'false',
    }).forcePathStyle,
  ).toBe(false)
  expect(() =>
    S3Settings.parse({
      bucket: 'b',
      accessKeyId: 'i',
      secretAccessKey: 's',
      forcePathStyle: 'yes',
    }),
  ).toThrow('true or false')
})
