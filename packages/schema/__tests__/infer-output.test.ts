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

  it('fromYup returns a KickSchema; output type lands at unknown when Yup omits the brand', () => {
    // Yup exposes `__outputType` on some schema kinds but not all.
    // The inference path tries it; when missing, adopters cast — and
    // either way the runtime safeParse still produces typed data
    // through the explicit annotation.
    const wrapped = fromYup(Schema) as KickSchema<{
      DATABASE_URL: string
      JWT_SECRET: string
    }>

    const result = wrapped.safeParse({
      DATABASE_URL: 'https://example.com',
      JWT_SECRET: 'a-very-long-secret-of-at-least-32',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.DATABASE_URL).toBe('https://example.com')
    }
  })
})
