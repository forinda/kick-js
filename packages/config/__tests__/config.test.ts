import 'reflect-metadata'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'
import {
  baseEnvSchema,
  defineEnv,
  loadEnv,
  getEnv,
  resetEnvCache,
  ConfigService,
  createConfigService,
} from '@forinda/kickjs-config'
import { Container } from '@forinda/kickjs'

// Snapshot original env values so we can restore them
const originalEnv: Record<string, string | undefined> = {}
const managedKeys = ['PORT', 'NODE_ENV', 'LOG_LEVEL', 'DATABASE_URL', 'JWT_SECRET', 'REDIS_URL']

beforeEach(() => {
  for (const key of managedKeys) {
    originalEnv[key] = process.env[key]
  }
  resetEnvCache()
  Container.reset()
})

afterEach(() => {
  for (const key of managedKeys) {
    if (originalEnv[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = originalEnv[key]
    }
  }
  resetEnvCache()
})

// ---------------------------------------------------------------------------
// baseEnvSchema
// ---------------------------------------------------------------------------
describe('baseEnvSchema', () => {
  it('should apply defaults when env vars are missing', () => {
    delete process.env.PORT
    delete process.env.NODE_ENV
    delete process.env.LOG_LEVEL

    const result = baseEnvSchema.parse(process.env)

    expect(result.PORT).toBe(3000)
    expect(result.NODE_ENV).toBe('development')
    expect(result.LOG_LEVEL).toBe('info')
  })

  it('should coerce PORT from string to number', () => {
    process.env.PORT = '8080'
    const result = baseEnvSchema.parse(process.env)
    expect(result.PORT).toBe(8080)
  })

  it('should accept valid NODE_ENV values', () => {
    for (const env of ['development', 'production', 'test'] as const) {
      process.env.NODE_ENV = env
      const result = baseEnvSchema.parse(process.env)
      expect(result.NODE_ENV).toBe(env)
    }
  })

  it('should reject invalid NODE_ENV values', () => {
    process.env.NODE_ENV = 'staging'
    expect(() => baseEnvSchema.parse(process.env)).toThrow()
  })

  it('should accept a custom LOG_LEVEL string', () => {
    process.env.LOG_LEVEL = 'debug'
    const result = baseEnvSchema.parse(process.env)
    expect(result.LOG_LEVEL).toBe('debug')
  })
})

// ---------------------------------------------------------------------------
// defineEnv
// ---------------------------------------------------------------------------
describe('defineEnv', () => {
  it('should extend the base schema with custom fields', () => {
    const schema = defineEnv((base) =>
      base.extend({
        DATABASE_URL: z.string().url(),
      }),
    )

    process.env.DATABASE_URL = 'https://db.example.com'
    delete process.env.PORT

    const result = schema.parse(process.env)
    expect(result.DATABASE_URL).toBe('https://db.example.com')
    // Base fields still present with defaults
    expect(result.PORT).toBe(3000)
  })

  it('should fail when required custom field is missing', () => {
    const schema = defineEnv((base) =>
      base.extend({
        JWT_SECRET: z.string().min(32),
      }),
    )

    delete process.env.JWT_SECRET

    expect(() => schema.parse(process.env)).toThrow()
  })
})

// ---------------------------------------------------------------------------
// loadEnv
// ---------------------------------------------------------------------------
describe('loadEnv', () => {
  it('should parse process.env with the base schema when no schema provided', () => {
    process.env.PORT = '4000'
    process.env.NODE_ENV = 'test'

    const env = loadEnv()

    expect(env.PORT).toBe(4000)
    expect(env.NODE_ENV).toBe('test')
  })

  it('should parse process.env with a custom schema', () => {
    const schema = defineEnv((base) =>
      base.extend({
        DATABASE_URL: z.string().url(),
      }),
    )

    process.env.PORT = '5000'
    process.env.DATABASE_URL = 'https://db.example.com'

    const env = loadEnv(schema)
    expect(env.PORT).toBe(5000)
    expect(env.DATABASE_URL).toBe('https://db.example.com')
  })

  it('should cache the result for the same schema', () => {
    process.env.PORT = '3000'
    const env1 = loadEnv()

    // Mutate env after first load — cached value should be returned
    process.env.PORT = '9999'
    const env2 = loadEnv()

    expect(env1).toBe(env2) // Same reference
    expect(env2.PORT).toBe(3000) // Still old value
  })

  it('should re-parse when a different schema is provided', () => {
    process.env.PORT = '3000'
    process.env.DATABASE_URL = 'https://db.example.com'

    const env1 = loadEnv()

    const customSchema = defineEnv((base) =>
      base.extend({
        DATABASE_URL: z.string().url(),
      }),
    )

    const env2 = loadEnv(customSchema)

    expect(env1).not.toBe(env2)
    expect(env2.DATABASE_URL).toBe('https://db.example.com')
  })

  it('should register the env resolver on Container', () => {
    process.env.PORT = '7777'
    loadEnv()

    expect(Container._envResolver).toBeDefined()
    expect(Container._envResolver!('PORT')).toBe(7777)
  })
})

// ---------------------------------------------------------------------------
// getEnv
// ---------------------------------------------------------------------------
describe('getEnv', () => {
  it('should retrieve a single env value using the base schema', () => {
    process.env.PORT = '4200'
    const port = getEnv('PORT')
    expect(port).toBe(4200)
  })

  it('should retrieve a custom field when schema is provided', () => {
    const schema = defineEnv((base) =>
      base.extend({
        DATABASE_URL: z.string().url(),
      }),
    )

    process.env.DATABASE_URL = 'https://db.example.com'

    const dbUrl = getEnv('DATABASE_URL', schema)
    expect(dbUrl).toBe('https://db.example.com')
  })
})

// ---------------------------------------------------------------------------
// resetEnvCache
// ---------------------------------------------------------------------------
describe('resetEnvCache', () => {
  it('should force re-parsing on next loadEnv call', () => {
    process.env.PORT = '3000'
    const env1 = loadEnv()
    expect(env1.PORT).toBe(3000)

    process.env.PORT = '9999'
    resetEnvCache()

    const env2 = loadEnv()
    expect(env2.PORT).toBe(9999)
    expect(env1).not.toBe(env2)
  })
})

// ---------------------------------------------------------------------------
// ConfigService
// ---------------------------------------------------------------------------
describe('ConfigService', () => {
  let service: ConfigService

  beforeEach(() => {
    process.env.PORT = '3000'
    process.env.NODE_ENV = 'test'
    process.env.LOG_LEVEL = 'debug'
    resetEnvCache()
    service = new ConfigService()
  })

  it('should get a config value by key', () => {
    expect(service.get('PORT')).toBe(3000)
    expect(service.get('LOG_LEVEL')).toBe('debug')
  })

  it('should return all config as a frozen object', () => {
    const all = service.getAll()
    expect(all.PORT).toBe(3000)
    expect(Object.isFrozen(all)).toBe(true)
  })

  it('should detect environment correctly', () => {
    expect(service.isTest()).toBe(true)
    expect(service.isProduction()).toBe(false)
    expect(service.isDevelopment()).toBe(false)
  })

  it('should detect production environment', () => {
    process.env.NODE_ENV = 'production'
    resetEnvCache()
    const prodService = new ConfigService()

    expect(prodService.isProduction()).toBe(true)
    expect(prodService.isDevelopment()).toBe(false)
    expect(prodService.isTest()).toBe(false)
  })

  it('should detect development environment', () => {
    process.env.NODE_ENV = 'development'
    resetEnvCache()
    const devService = new ConfigService()

    expect(devService.isDevelopment()).toBe(true)
    expect(devService.isProduction()).toBe(false)
    expect(devService.isTest()).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// createConfigService
// ---------------------------------------------------------------------------
describe('createConfigService', () => {
  it('should create a typed config service class', () => {
    const schema = defineEnv((base) =>
      base.extend({
        DATABASE_URL: z.string().url(),
      }),
    )

    process.env.PORT = '5000'
    process.env.DATABASE_URL = 'https://db.example.com'
    resetEnvCache()

    const AppConfig = createConfigService(schema)
    const config = new AppConfig()

    expect(config.get('PORT')).toBe(5000)
    expect(config.get('DATABASE_URL')).toBe('https://db.example.com')
  })

  it('should return frozen config from getAll()', () => {
    const schema = defineEnv((base) =>
      base.extend({
        DATABASE_URL: z.string().url(),
      }),
    )

    process.env.DATABASE_URL = 'https://db.example.com'
    resetEnvCache()

    const AppConfig = createConfigService(schema)
    const config = new AppConfig()
    const all = config.getAll()

    expect(all.DATABASE_URL).toBe('https://db.example.com')
    expect(Object.isFrozen(all)).toBe(true)
  })

  it('should report environment helpers correctly', () => {
    process.env.NODE_ENV = 'production'
    resetEnvCache()

    const AppConfig = createConfigService(baseEnvSchema)
    const config = new AppConfig()

    expect(config.isProduction()).toBe(true)
    expect(config.isDevelopment()).toBe(false)
    expect(config.isTest()).toBe(false)
  })
})
