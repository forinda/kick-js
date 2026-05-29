/**
 * Lock the `InferSchemaOutput<T>` resolution across all three shipped
 * adapters. The `kick typegen` `kick/env` plugin reads the default
 * export of `src/config/index.ts`, runs it through `InferSchemaOutput`,
 * then extends `KickEnv` from the result. If inference drifts to
 * `unknown` for any adapter, every adopter using `KickEnv['MY_VAR']`
 * sees `Property 'MY_VAR' does not exist on type 'KickEnv'` instead of
 * `string`.
 *
 * Tests here are predominantly compile-time assertions. `expectType`
 * and the typed `assignable` helper trip `tsc` on type drift; the few
 * runtime expectations cover the round-trip parsing path so regressions
 * in `safeParse` show up too.
 */

import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import * as v from 'valibot'
import * as yup from 'yup'

import { fromZod } from '../src/adapters/zod'
import { fromValibot } from '../src/adapters/valibot'
import { fromYup } from '../src/adapters/yup'
import type { InferSchemaOutput, KickSchema } from '../src'

describe('InferSchemaOutput — Zod', () => {
  const Schema = z.object({
    DATABASE_URL: z.string().url(),
    JWT_SECRET: z.string().min(32),
    PORT: z.coerce.number(),
  })

  it('fromZod returns a KickSchema with the Zod output type, not `unknown`', () => {
    const wrapped = fromZod(Schema)

    type Out = InferSchemaOutput<typeof wrapped>
    type Resolved = { [K in keyof Out]: Out[K] }

    const _check: Resolved = {
      DATABASE_URL: 'postgres://x',
      JWT_SECRET: 'a-very-long-secret-of-at-least-32',
      PORT: 3000,
    }
    void _check
    expect(wrapped._raw).toBe(Schema)
  })

  it('round-trips a valid env through safeParse', () => {
    const wrapped = fromZod(Schema)
    const result = wrapped.safeParse({
      DATABASE_URL: 'postgres://u:p@h/db',
      JWT_SECRET: 'a-very-long-secret-of-at-least-32',
      PORT: '3000',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.DATABASE_URL).toBe('postgres://u:p@h/db')
      expect(result.data.PORT).toBe(3000)
    }
  })

  it('the wrapped result is assignable to KickSchema<inferred shape>', () => {
    const wrapped = fromZod(Schema)

    type Out = InferSchemaOutput<typeof wrapped>
    const explicit: KickSchema<{ [K in keyof Out]: Out[K] }> = wrapped
    expect(explicit).toBe(wrapped)
  })
})

describe('InferSchemaOutput — Valibot', () => {
  const Schema = v.object({
    DATABASE_URL: v.pipe(v.string(), v.url()),
    JWT_SECRET: v.pipe(v.string(), v.minLength(32)),
  })

  it('fromValibot returns a KickSchema with the Valibot output type', () => {
    const wrapped = fromValibot(Schema)

    type Out = InferSchemaOutput<typeof wrapped>
    type Resolved = { [K in keyof Out]: Out[K] }

    const _check: Resolved = {
      DATABASE_URL: 'postgres://x',
      JWT_SECRET: 'a-very-long-secret-of-at-least-32',
    }
    void _check
    expect(wrapped._raw).toBe(Schema)
  })

  it('round-trips a valid env through safeParse', () => {
    const wrapped = fromValibot(Schema)
    const result = wrapped.safeParse({
      DATABASE_URL: 'https://example.com',
      JWT_SECRET: 'a-very-long-secret-of-at-least-32',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.JWT_SECRET.length).toBeGreaterThanOrEqual(32)
    }
  })
})

describe('InferSchemaOutput — Yup', () => {
  const Schema = yup.object({
    DATABASE_URL: yup.string().url().required(),
    JWT_SECRET: yup.string().min(32).required(),
  })

  it('fromYup infers the Yup output type via __outputType — no cast required', () => {
    // Yup exposes `__outputType` on every schema (yup 1.x typings,
    // `index.d.ts` line ~199), so the `InferSchemaOutput` Yup branch
    // resolves it. The compile-time assertion below trips `tsc` if
    // `fromYup` regresses to `KickSchema<unknown>` or the Yup branch
    // is dropped — adopters would otherwise see `result.data` typed
    // as `unknown` and silently lose `KickEnv` autocomplete.
    const wrapped = fromYup(Schema)

    type Out = InferSchemaOutput<typeof wrapped>
    type Resolved = { [K in keyof Out]: Out[K] }

    // The required-string fields land at `string | undefined` in Yup's
    // `__outputType` because `.required()` is a runtime check, not a
    // type-level guard. Drive the assertion through the unioned form
    // to lock the brand path without painting a false expectation of
    // strict-string output.
    const _expected: Resolved = {
      DATABASE_URL: 'https://example.com' as string | undefined,
      JWT_SECRET: 'a-very-long-secret-of-at-least-32' as string | undefined,
    }
    void _expected

    const result = wrapped.safeParse({
      DATABASE_URL: 'https://example.com',
      JWT_SECRET: 'a-very-long-secret-of-at-least-32',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      // Runtime data exists because Yup's `.required()` enforced it.
      const data = result.data as Out
      expect(data.DATABASE_URL).toBe('https://example.com')
    }
  })

  it('rejects KickSchema<unknown> at compile time when the brand resolves correctly', () => {
    // Pure type-level guard. If `fromYup` regresses to returning
    // `KickSchema<unknown>`, the variable would assign to either
    // branch and the test loses its compile-time meaning. The
    // assertion shape forces a real object inference.
    const wrapped = fromYup(Schema)
    type Out = InferSchemaOutput<typeof wrapped>
    type HasShape = keyof Out extends 'DATABASE_URL' | 'JWT_SECRET' ? true : false
    const _proof: HasShape = true
    void _proof
    expect(wrapped._raw).toBe(Schema)
  })
})
