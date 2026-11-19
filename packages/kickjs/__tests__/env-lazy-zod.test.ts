/**
 * Locks the "zod is an optional peer" guarantee.
 *
 * `packages/kickjs/src/config/env.ts` used to `import { z } from 'zod'`
 * at module top-level and build `baseEnvSchema = z.object(...)` eagerly.
 * Because the env module is re-exported from the main `@forinda/kickjs`
 * entry, that turned zod into a *hard* dependency of the whole
 * framework: `import { anything } from '@forinda/kickjs'` crashed at
 * load time for any app that validates env via Valibot / Yup / a plain
 * function and never installed zod.
 *
 * zod is now lazy-loaded only inside `baseEnvSchema` / `defineEnv` /
 * `loadEnv`. The non-zod path (`loadEnvFromSchema` → `detectSchema`)
 * must validate env without ever touching zod.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Container, getEnv, loadEnvFromSchema, reloadEnv, resetEnvCache } from '../src'

afterEach(() => {
  resetEnvCache()
  Container.reset()
  delete process.env.LAZY_ZOD_PORT
})

describe('env validation without zod (loadEnvFromSchema)', () => {
  it('validates process.env via a plain function schema — no zod required', () => {
    process.env.LAZY_ZOD_PORT = '4321'
    // A function validator is one of the non-zod shapes detectSchema
    // accepts. Reaching this far never loads zod.
    const env = loadEnvFromSchema((raw: Record<string, string | undefined>) => ({
      LAZY_ZOD_PORT: Number(raw.LAZY_ZOD_PORT),
    })) as { LAZY_ZOD_PORT: number }

    expect(env.LAZY_ZOD_PORT).toBe(4321)
  })

  it('wires the @Value resolver from the non-zod result', () => {
    process.env.LAZY_ZOD_PORT = '9999'
    loadEnvFromSchema((raw: Record<string, string | undefined>) => ({
      LAZY_ZOD_PORT: Number(raw.LAZY_ZOD_PORT),
    }))
    // _envResolver is what @Value() / ConfigService read through.
    expect(Container.envResolver?.('LAZY_ZOD_PORT')).toBe(9999)
  })

  it('reads again after a failed reload (an HMR save mid-edit), without Zod', () => {
    const schema = (env: Record<string, unknown>) => {
      if (!env.LAZY_ZOD_PORT) throw new Error('LAZY_ZOD_PORT is required')
      return { LAZY_ZOD_PORT: Number(env.LAZY_ZOD_PORT) }
    }
    process.env.LAZY_ZOD_PORT = '1'
    loadEnvFromSchema(schema)
    delete process.env.LAZY_ZOD_PORT
    expect(() => reloadEnv()).toThrow(/LAZY_ZOD_PORT/)
    process.env.LAZY_ZOD_PORT = '2'
    // Read through the sticky schema — once called its Zod `.parse()`.
    expect(getEnv('LAZY_ZOD_PORT' as never)).toBe(2)
  })
})
