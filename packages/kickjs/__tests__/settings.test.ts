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
  createToken,
  defineAdapter,
  defineSettings,
  type SettingsOf,
} from '../src/index'
import { createWebApp } from '../src/web'

beforeEach(() => Container.reset())
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
    await new Application({ modules: [], settings: [DbSettings] }).setup()
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
    const app = new Application({ modules: [], settings: [DbSettings] })
    await app.setup()
    expect(app.getContainer().resolve(Database).settings.pool.max).toBe(10)
  })

  it('fails startup when a section is invalid', async () => {
    vi.stubEnv('KT_DB_URL', 'not a url')
    await expect(new Application({ modules: [], settings: [DbSettings] }).setup()).rejects.toThrow(
      /KT_DB_URL/,
    )
  })

  it('reads the platform env on the web entry', () => {
    createWebApp({
      h3: h3v2,
      modules: [],
      settings: [DbSettings],
      env: { KT_DB_URL: 'postgres://edge/app' },
    })
    expect(Container.getInstance().resolve(DbSettings).url).toBe('postgres://edge/app')
  })
})

describe('settings from adapters and modules', () => {
  beforeEach(() => vi.stubEnv('KT_DB_URL', 'postgres://env/app'))

  it('configures an adapter through .async({ inject })', async () => {
    let seen: unknown
    const DbAdapter = defineAdapter<{ url: string }>({
      name: 'DbAdapter',
      build: (config) => ({ beforeStart: () => void (seen = config.url) }),
    })
    const app = new Application({
      modules: [],
      settings: [DbSettings],
      adapters: [
        DbAdapter.async({
          inject: [DbSettings],
          useFactory: (db: SettingsOf<typeof DbSettings>) => ({ url: db.url }),
        }),
      ],
    })
    await app.setup()
    expect(seen).toBe('postgres://env/app')
  })

  it('a module can bind a value under its own token, or replace the section — get() follows', async () => {
    const DB_URL = createToken<string>('test/dbUrl')
    const app = new Application({
      settings: [DbSettings],
      modules: [
        {
          register(container: Container) {
            container.registerFactory(DB_URL, () => container.resolve(DbSettings).url)
            container.registerInstance(DbSettings, {
              ...DbSettings.load(),
              url: 'postgres://module/app',
            })
          },
          routes: () => null,
        } as never,
      ],
    })
    await app.setup()
    expect(app.getContainer().resolve(DB_URL)).toBe('postgres://module/app')
    // Outside DI, get() sees the same replacement injected code does.
    expect(DbSettings.get().url).toBe('postgres://module/app')
  })
})

describe('declaring sections', () => {
  const Broken = defineSettings('KT_BROKEN', z.object({ required: z.string() }))

  it('validates only declared sections — an undeclared, invalid one does not fail startup', async () => {
    await expect(new Application({ modules: [] }).setup()).resolves.toBeUndefined()
    // …but get() validates it on first use.
    expect(() => Broken.get()).toThrow(/KT_BROKEN_REQUIRED/)
  })

  it('binds a module section only when the module is mounted, before it registers', async () => {
    vi.stubEnv('KT_DB_URL', 'postgres://module/app')
    let seenInRegister: string | undefined
    const DbModule = {
      settings: () => [DbSettings],
      register(container: Container) {
        seenInRegister = container.resolve(DbSettings).url
      },
      routes: () => null,
    }
    const app = new Application({ modules: [DbModule as never] })
    await app.setup()
    expect(seenInRegister).toBe('postgres://module/app')

    // Not mounted, not validated: an invalid value doesn't fail an app that
    // doesn't load the module.
    Container.reset()
    vi.stubEnv('KT_DB_URL', 'not a url')
    await expect(new Application({ modules: [] }).setup()).resolves.toBeUndefined()
    await expect(new Application({ modules: [DbModule as never] }).setup()).rejects.toThrow(
      /KT_DB_URL/,
    )
  })

  it('takes sections from adapters and plugins, skipping a disabled adapter', async () => {
    vi.stubEnv('KT_DB_URL', 'postgres://adapter/app')
    const app = new Application({
      modules: [],
      plugins: [{ name: 'P', settings: () => [DbSettings] }],
      adapters: [
        { name: 'Off', when: () => false, settings: () => [Broken] },
        { name: 'On', settings: () => [DbSettings] },
      ],
    })
    await expect(app.setup()).resolves.toBeUndefined()
    expect(app.getContainer().resolve(DbSettings).url).toBe('postgres://adapter/app')
  })

  it('lists every invalid section in one error, and refuses two sections sharing a prefix', async () => {
    const Other = defineSettings('KT_BROKEN', z.object({ x: z.string().optional() }))
    await expect(
      new Application({ modules: [], settings: [DbSettings, Broken] }).setup(),
    ).rejects.toThrow(/KT_DB_URL[\s\S]*KT_BROKEN_REQUIRED/)
    await expect(
      new Application({ modules: [], settings: [Broken, Other] }).setup(),
    ).rejects.toThrow(/Two different settings sections use the prefix 'KT_BROKEN'/)
  })
})

describe('scoped sections', () => {
  it('reads a second instance under a prefixed name, as its own token', async () => {
    const Analytics = DbSettings.scoped('ANALYTICS')
    expect(Analytics).toBe(DbSettings.scoped('ANALYTICS'))
    expect(Analytics.prefix).toBe('ANALYTICS_KT_DB')
    expect(Analytics.envNames[0]).toBe('ANALYTICS_KT_DB_URL')

    vi.stubEnv('KT_DB_URL', 'postgres://main/app')
    vi.stubEnv('ANALYTICS_KT_DB_URL', 'postgres://analytics/app')
    const app = new Application({ modules: [], settings: [DbSettings, Analytics] })
    await app.setup()
    expect(app.getContainer().resolve(DbSettings).url).toBe('postgres://main/app')
    expect(app.getContainer().resolve(Analytics).url).toBe('postgres://analytics/app')
  })
})

describe('review fixes', () => {
  it('refuses two keys that would read the same variable', () => {
    expect(() =>
      defineSettings('KT_CLASH', z.object({ fooBar: z.string(), foo_bar: z.string() })),
    ).toThrow(/'fooBar' and 'foo_bar' both read KT_CLASH_FOO_BAR/)
  })

  it('caches get() per section, not per prefix', () => {
    const A = defineSettings('KT_SAME', z.object({ a: z.string().default('a') }))
    const B = defineSettings('KT_SAME', z.object({ b: z.string().default('b') }))
    expect(A.get()).toEqual({ a: 'a' })
    expect(B.get()).toEqual({ b: 'b' })
  })

  it('refuses a prefix clash between app and module sections', async () => {
    const AppSide = defineSettings('KT_DUP', z.object({ x: z.string().default('1') }))
    const ModuleSide = defineSettings('KT_DUP', z.object({ y: z.string().default('2') }))
    const mod = { settings: () => [ModuleSide], routes: () => null }
    await expect(
      new Application({ modules: [mod as never], settings: [AppSide] }).setup(),
    ).rejects.toThrow(/Two different settings sections use the prefix 'KT_DUP'/)
    // The same section declared in both phases is fine.
    Container.reset()
    const shared = { settings: () => [AppSide], routes: () => null }
    await expect(
      new Application({ modules: [shared as never], settings: [AppSide] }).setup(),
    ).resolves.toBeUndefined()
  })
})

describe('provided settings', () => {
  it('binds a supplied value, validated with defaults, instead of reading env', async () => {
    vi.stubEnv('KT_DB_URL', 'postgres://from-env/app')
    const app = new Application({
      modules: [],
      settings: [DbSettings.provide({ url: 'postgres://container:5432/test' })],
    })
    await app.setup()
    const value = app.getContainer().resolve(DbSettings)
    expect(value.url).toBe('postgres://container:5432/test')
    expect(value.pool.max).toBe(10)
    expect(DbSettings.get().url).toBe('postgres://container:5432/test')
  })

  it('wins over the same section declared by a module, and needs no env for it', async () => {
    const DbModule = { settings: () => [DbSettings], routes: () => null }
    const app = new Application({
      modules: [DbModule as never],
      settings: [DbSettings.provide({ url: 'postgres://provided/app' })],
    })
    await app.setup()
    expect(app.getContainer().resolve(DbSettings).url).toBe('postgres://provided/app')
  })

  it('fails startup when the provided value is invalid', async () => {
    await expect(
      new Application({ modules: [], settings: [DbSettings.provide({ url: 'nope' })] }).setup(),
    ).rejects.toThrow(/KT_DB_URL/)
  })

  it('a module-provided value wins over the app reading the same section from env', async () => {
    vi.stubEnv('KT_DB_URL', 'postgres://from-env/app')
    const TestModule = {
      settings: () => [DbSettings.provide({ url: 'postgres://module/app' })],
      routes: () => null,
    }
    const app = new Application({ modules: [TestModule as never], settings: [DbSettings] })
    await app.setup()
    expect(app.getContainer().resolve(DbSettings).url).toBe('postgres://module/app')
  })

  it('fails startup when one section is provided twice with different values', async () => {
    const TestModule = {
      settings: () => [DbSettings.provide({ url: 'postgres://module/app' })],
      routes: () => null,
    }
    await expect(
      new Application({
        modules: [TestModule as never],
        settings: [DbSettings.provide({ url: 'postgres://app/app' })],
      }).setup(),
    ).rejects.toThrow(/provided twice/)
  })
})

describe('value origins', () => {
  it('reports env, file, default, provided and unset — names only', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kt-origins-'))
    writeFileSync(join(dir, 'key'), 'secret')
    const Mail = defineSettings(
      'KT_MAIL',
      z.object({
        host: z.string(),
        key: z.string(),
        port: z.coerce.number().default(25),
        from: z.string().optional(),
      }),
    )
    vi.stubEnv('KT_MAIL_HOST', 'smtp.local')
    vi.stubEnv('KT_MAIL_KEY_FILE', join(dir, 'key'))
    const app = new Application({
      modules: [],
      settings: [Mail, DbSettings.provide({ url: 'postgres://provided/app' })],
    })
    await app.setup()
    const { sections } = app.configOrigins()
    expect(sections.find((s) => s.prefix === 'KT_MAIL')?.vars).toEqual([
      { name: 'KT_MAIL_HOST', origin: 'env' },
      { name: 'KT_MAIL_KEY', origin: 'file' },
      { name: 'KT_MAIL_PORT', origin: 'default' },
      { name: 'KT_MAIL_FROM', origin: 'unset' },
    ])
    expect(
      sections.find((s) => s.prefix === 'KT_DB')?.vars.every((v) => v.origin === 'provided'),
    ).toBe(true)
    expect(JSON.stringify(sections)).not.toContain('secret')
  })
})

describe('a failed rebuild', () => {
  it('keeps the previous app’s config origins', async () => {
    vi.stubEnv('KT_DB_URL', 'postgres://env/app')
    const app = new Application({ modules: [], settings: [DbSettings] })
    await app.setup()
    vi.stubEnv('KT_DB_URL', '')
    await app.rebuild() // fails: KT_DB_URL is required; the old app stays
    expect(app.configOrigins().sections.map((s) => s.prefix)).toContain('KT_DB')
  })
})
