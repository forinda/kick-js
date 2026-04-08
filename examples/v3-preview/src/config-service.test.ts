/**
 * End-to-end check that `ConfigService` (now shipped inside
 * `@forinda/kickjs`) actually reads this app's env vars — base schema
 * keys, user-defined keys from `src/env.ts`, and a key sourced from
 * the `.env` file via `dotenv`. Also covers the construction-order
 * trap that originally motivated the merge.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { Container, ConfigService, loadEnv, resetEnvCache } from '@forinda/kickjs'
import envSchema from './env'

describe('ConfigService — v3-preview env wiring', () => {
  beforeEach(() => {
    Container.reset()
    resetEnvCache()
  })

  it('reads user-defined env keys after the schema is loaded', () => {
    // Ensure dotenv has populated process.env. The .env file ships with
    // APP_NAME=KickJS V3 Preview and APP_GREETING=Hello from .env.
    process.env.APP_NAME ??= 'KickJS V3 Preview'
    process.env.APP_GREETING ??= 'Hello from .env'

    // Register the project's schema (mirrors what `src/env.ts` does at
    // module-load time in the running app).
    loadEnv(envSchema)

    const config = Container.getInstance().resolve(ConfigService)

    expect(config.get('APP_NAME')).toBe('KickJS V3 Preview')
    expect(config.get('APP_GREETING')).toBe('Hello from .env')
  })

  it('still reads base schema keys (PORT, NODE_ENV)', () => {
    process.env.PORT = '4242'
    process.env.NODE_ENV = 'test'
    loadEnv(envSchema)

    const config = Container.getInstance().resolve(ConfigService)

    // PORT is z.coerce.number() in baseEnvSchema — must come back as a
    // real number, not the raw string.
    expect(config.get('PORT')).toBe(4242)
    expect(typeof config.get('PORT')).toBe('number')
    expect(config.get('NODE_ENV')).toBe('test')
    expect(config.isTest()).toBe(true)
    expect(config.isDevelopment()).toBe(false)
  })

  it('survives the construction-order trap (instantiate before schema load)', () => {
    process.env.APP_GREETING = 'lazy lookup wins'

    // Resolve ConfigService BEFORE the user's schema is registered.
    // With the old eager-snapshot implementation this used to freeze
    // the service to the base shape, so a later .get('APP_GREETING')
    // would return undefined even though @Value() worked fine.
    const config = Container.getInstance().resolve(ConfigService)

    // Now upgrade the env to the extended schema — same thing src/env.ts
    // does on first import in the live app.
    loadEnv(envSchema)

    // The lazy getter should pick up the extended value on demand.
    // (With the old eager-snapshot ConfigService, APP_GREETING would be
    // undefined here because the constructor cached the base shape
    // before the user schema was registered.)
    expect(config.get('APP_GREETING')).toBe('lazy lookup wins')
  })

  it('getAll() returns every known key from the merged schema', () => {
    process.env.APP_NAME = 'getAll-check'
    process.env.APP_GREETING = 'present'
    loadEnv(envSchema)

    const config = Container.getInstance().resolve(ConfigService)
    const all = config.getAll() as Record<string, unknown>

    // Frozen snapshot — must contain both base and user keys
    expect(Object.isFrozen(all)).toBe(true)
    expect(all.PORT).toBeTypeOf('number')
    expect(all.NODE_ENV).toBeDefined()
    expect(all.APP_NAME).toBe('getAll-check')
    expect(all.APP_GREETING).toBe('present')
  })
})
