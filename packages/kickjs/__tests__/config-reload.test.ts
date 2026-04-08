/**
 * Regression test for the "reloadEnv() loses the user schema" bug.
 *
 * The original `reloadEnv()` discarded the user-registered schema
 * along with the parsed values. That looked harmless in unit tests,
 * but in a running dev server it produced a silent failure:
 *
 *   1. App boots, `src/config/index.ts` registers the extended schema,
 *      every controller resolves and `ConfigService.get('CUSTOM_KEY')`
 *      works correctly.
 *   2. User edits `.env`. `envWatchPlugin` triggers a Vite full reload,
 *      which calls `reloadEnv()`.
 *   3. The registered schema is lost. The next read silently downgrades
 *      to the base schema, and `config.get('CUSTOM_KEY')` returns
 *      `undefined` for the rest of the dev session.
 *
 * The fix: `reloadEnv()` only clears the parsed values and re-parses
 * `process.env` against the still-registered schema. This test locks
 * that behaviour in via the public API only.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { z } from 'zod'
import {
  ConfigService,
  Container,
  defineEnv,
  loadEnv,
  reloadEnv,
  resetEnvCache,
} from '../src'

describe('reloadEnv() preserves the user-registered schema', () => {
  beforeEach(() => {
    Container.reset()
    resetEnvCache()
    delete process.env.APP_GREETING
    delete process.env.CUSTOM_PORT
  })

  it('keeps user keys readable after a reload (the original bug)', () => {
    const schema = defineEnv((base) =>
      base.extend({
        APP_GREETING: z.string(),
      }),
    )

    process.env.APP_GREETING = 'hello v1'
    loadEnv(schema)

    const config = Container.getInstance().resolve(ConfigService)
    expect(config.get('APP_GREETING')).toBe('hello v1')

    // Simulate a `.env` file change: env var updated, then envWatchPlugin
    // (or HMR rebuild) calls reloadEnv().
    process.env.APP_GREETING = 'hello v2'
    reloadEnv()

    // The user-defined key MUST still resolve through ConfigService.
    // Pre-fix this returned `undefined` because cachedSchema had been
    // wiped and the next loadEnv() fell back to baseEnvSchema.
    expect(config.get('APP_GREETING')).toBe('hello v2')
  })

  it('re-parses Zod-coerced base keys against the cached schema', () => {
    const schema = defineEnv((base) =>
      base.extend({
        APP_GREETING: z.string().default('default greeting'),
      }),
    )

    process.env.PORT = '3000'
    loadEnv(schema)
    const config = Container.getInstance().resolve(ConfigService)
    expect(config.get('PORT')).toBe(3000)
    expect(typeof config.get('PORT')).toBe('number')

    // Simulate the user changing PORT in .env
    process.env.PORT = '4242'
    reloadEnv()

    // Coercion must still happen — base schema's z.coerce.number() is
    // applied because the schema reference survived the reload.
    expect(config.get('PORT')).toBe(4242)
    expect(typeof config.get('PORT')).toBe('number')
  })

  it('resetEnvCache() still wipes the schema (for tests that need a fresh slate)', () => {
    const schema = defineEnv((base) =>
      base.extend({
        APP_GREETING: z.string().default('hi'),
      }),
    )
    loadEnv(schema)

    resetEnvCache()

    // After resetEnvCache, no-arg loadEnv() should fall back to the
    // base schema — APP_GREETING is no longer recognised.
    const env = loadEnv() as Record<string, unknown>
    expect(env.APP_GREETING).toBeUndefined()
    expect(env.PORT).toBeDefined() // base key still works
  })
})
