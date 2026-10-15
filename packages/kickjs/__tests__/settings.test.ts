import 'reflect-metadata'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import * as v from 'valibot'
import * as y from 'yup'
import * as h3v2 from 'h3'
import {
  Application,
  Container,
  Inject,
  Service,
  defineSettings,
  type SettingsOf,
} from '../src/index'
import { createWebApp } from '../src/web'

beforeEach(() => {
  Container.reset()
  // Every section defined in the process is validated when an app starts —
  // as an app's tests would get from .env.test.
  vi.stubEnv('KT_MAIL_HOST', 'smtp')
  vi.stubEnv('KT_MAIL_PORT', '587')
  vi.stubEnv('KT_CACHE_URL', 'redis://c')
})
afterEach(() => vi.unstubAllEnvs())

const DbSettings = defineSettings(
  'KT_DB',
  z.object({
    url: z.string().url(),
    pool: z.object({ max: z.coerce.number().int().default(10) }).default({ max: 10 }),
    maxConnections: z.coerce.number().optional(),
    replicas: z.array(z.string()).default([]),
    ssl: z.stringbool().default(false),
  }),
)

describe('defineSettings', () => {
  it('maps key paths to UPPER_SNAKE env names under the prefix', () => {
    expect(DbSettings.envNames).toEqual([
      'KT_DB_URL',
      'KT_DB_POOL_MAX',
      'KT_DB_MAX_CONNECTIONS',
      'KT_DB_REPLICAS',
      'KT_DB_SSL',
    ])
  })

  it('reads, coerces, defaults and splits lists', () => {
    const value = DbSettings.load({
      KT_DB_URL: 'postgres://db/app',
      KT_DB_POOL_MAX: '25',
      KT_DB_REPLICAS: 'r1, r2,',
      KT_DB_SSL: 'false',
    })
    expect(value).toEqual({
      url: 'postgres://db/app',
      pool: { max: 25 },
      replicas: ['r1', 'r2'],
      ssl: false,
    })
    expect(DbSettings.load({ KT_DB_URL: 'postgres://db/app' }).pool.max).toBe(10)
  })

  it('names the variables to fix when invalid', () => {
    expect(() => DbSettings.load({ KT_DB_POOL_MAX: 'lots' })).toThrow(
      /Settings 'KT_DB' are invalid:\n {2}KT_DB_URL: .*\n {2}KT_DB_POOL_MAX: /,
    )
  })

  it('reads <NAME>_FILE secrets', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kick-settings-'))
    writeFileSync(join(dir, 'url'), 'postgres://secret/app\n')
    expect(DbSettings.load({ KT_DB_URL_FILE: join(dir, 'url') }).url).toBe('postgres://secret/app')
  })

  it('rejects a prefix that is not UPPER_SNAKE_CASE', () => {
    expect(() => defineSettings('db', z.object({}))).toThrow(/UPPER_SNAKE_CASE/)
  })
})

describe('defineSettings with other schema libraries', () => {
  it('works with Valibot', () => {
    const Mail = defineSettings(
      'KT_MAIL',
      v.object({
        host: v.string(),
        port: v.pipe(v.string(), v.transform(Number), v.number()),
        cc: v.optional(v.array(v.string()), []),
      }),
    )
    expect(Mail.envNames).toEqual(['KT_MAIL_HOST', 'KT_MAIL_PORT', 'KT_MAIL_CC'])
    expect(Mail.load({ KT_MAIL_HOST: 'smtp', KT_MAIL_PORT: '587', KT_MAIL_CC: 'a@x,b@x' })).toEqual(
      {
        host: 'smtp',
        port: 587,
        cc: ['a@x', 'b@x'],
      },
    )
    expect(() => Mail.load({ KT_MAIL_PORT: '587' })).toThrow(/KT_MAIL_HOST/)
  })

  it('works with Yup', () => {
    const Cache = defineSettings(
      'KT_CACHE',
      y.object({ url: y.string().required(), ttl: y.object({ seconds: y.number().default(60) }) }),
    )
    expect(Cache.envNames).toEqual(['KT_CACHE_URL', 'KT_CACHE_TTL_SECONDS'])
    expect(Cache.load({ KT_CACHE_URL: 'redis://c', KT_CACHE_TTL_SECONDS: '30' })).toEqual({
      url: 'redis://c',
      ttl: { seconds: 30 },
    })
  })
})

describe('settings outside injection', () => {
  it('get() returns the value the app started with', async () => {
    vi.stubEnv('KT_DB_URL', 'postgres://started/app')
    await new Application({ modules: [] }).setup()
    // A later env change doesn't move what the app runs with…
    vi.stubEnv('KT_DB_URL', 'postgres://changed/app')
    expect(DbSettings.get().url).toBe('postgres://started/app')
    // …while load() reads afresh.
    expect(DbSettings.load().url).toBe('postgres://changed/app')
  })
})

describe('settings in the app', () => {
  it('validates at startup and injects the section', async () => {
    vi.stubEnv('KT_DB_URL', 'postgres://db/app')
    @Service()
    class Database {
      constructor(@Inject(DbSettings) readonly settings: SettingsOf<typeof DbSettings>) {}
    }
    const app = new Application({ modules: [] })
    await app.setup()
    expect(app.getContainer().resolve(Database).settings.pool.max).toBe(10)
  })

  it('fails startup when a section is invalid', async () => {
    vi.stubEnv('KT_DB_URL', 'not a url')
    await expect(new Application({ modules: [] }).setup()).rejects.toThrow(/KT_DB_URL/)
  })

  it('reads the platform env on the web entry', () => {
    createWebApp({
      h3: h3v2,
      modules: [],
      env: {
        KT_DB_URL: 'postgres://edge/app',
        KT_MAIL_HOST: 'smtp',
        KT_MAIL_PORT: '587',
        KT_CACHE_URL: 'redis://c',
      },
    })
    expect(Container.getInstance().resolve(DbSettings).url).toBe('postgres://edge/app')
  })
})
