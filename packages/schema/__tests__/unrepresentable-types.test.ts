/**
 * What JSON Schema can't express — dates, bigints, Maps, transforms — converts
 * instead of throwing, on every adapter, and `target` / `io` are honoured.
 */
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import * as v from 'valibot'
import * as yup from 'yup'
import { fromZod } from '../src/adapters/zod'
import { fromValibot } from '../src/adapters/valibot'
import { fromYup } from '../src/adapters/yup'

const dateTime = { type: 'string', format: 'date-time' }

describe('Zod', () => {
  it('converts dates, bigints and unrepresentable types', () => {
    const s = fromZod(
      z.object({
        at: z.date(),
        since: z.coerce.date(),
        big: z.int64(),
        anyBig: z.bigint(),
        m: z.map(z.string(), z.number()),
        t: z.string().transform(Number),
        c: z.custom<string>(() => true),
        due: z.date().default(() => new Date(0)),
      }),
    )
    const props = s.toJsonSchema({ target: 'openapi-3.0' }).properties as Record<string, any>
    expect(props.at).toEqual(dateTime)
    expect(props.since).toEqual(dateTime)
    expect(props.big).toEqual({ type: 'integer', format: 'int64' })
    expect(props.anyBig).toEqual({ type: 'integer' }) // no 64-bit bound
    expect(props.m).toEqual({})
    expect(props.t).toEqual({})
    expect(props.c).toEqual({})
    expect(props.due).toMatchObject(dateTime)
  })

  it('honours target and io', () => {
    const s = fromZod(z.object({ n: z.string().nullable(), page: z.number().default(1) }))
    expect((s.toJsonSchema({ target: 'openapi-3.0' }).properties as any).n).toEqual({
      type: 'string',
      nullable: true,
    })
    expect((s.toJsonSchema({ target: 'draft-07' }).properties as any).n).toEqual({
      type: ['string', 'null'],
    })
    expect(s.toJsonSchema({ io: 'input' }).required).toEqual(['n'])
    expect(s.toJsonSchema({ io: 'output' }).required).toEqual(['n', 'page'])
  })
})

describe('Valibot', () => {
  it('converts dates, bigints and unrepresentable types', () => {
    const s = fromValibot(
      v.object({
        at: v.date(),
        big: v.bigint(),
        set: v.set(v.string()),
        n: v.nullable(v.string()),
      }),
    )
    const props = s.toJsonSchema({ target: 'openapi-3.0' }).properties as Record<string, any>
    expect(props.at).toEqual(dateTime)
    expect(props.big).toEqual({ type: 'integer' }) // a Valibot bigint has no 64-bit bound
    expect(props.set).toEqual({})
    expect(props.n).toEqual({ type: 'string', nullable: true })
  })
})

describe('Valibot io', () => {
  it('describes input and output apart', () => {
    const s = fromValibot(v.object({ n: v.pipe(v.string(), v.transform(Number), v.number()) }))
    expect((s.toJsonSchema({ io: 'input' }).properties as any).n).toEqual({ type: 'string' })
    expect((s.toJsonSchema({ io: 'output' }).properties as any).n).toEqual({ type: 'number' })
  })
})

describe('request fields JSON cannot send', () => {
  it('warns once about a plain z.date(), never about a coerced one', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    fromZod(z.object({ at: z.coerce.date() })).toJsonSchema({ io: 'input' })
    fromZod(z.object({ at: z.date() })).toJsonSchema({ io: 'output' })
    expect(warn).not.toHaveBeenCalled()
    fromZod(z.object({ at: z.date() })).toJsonSchema({ io: 'input' })
    fromZod(z.object({ at: z.date() })).toJsonSchema({ io: 'input' })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toContain('z.coerce.date() or z.iso.datetime()')
    warn.mockRestore()
  })
})

describe('Yup', () => {
  it('gives dates a format and leaves types JSON Schema lacks untyped', () => {
    const s = fromYup(yup.object({ at: yup.date().required(), any: yup.mixed() }))
    const props = s.toJsonSchema().properties as Record<string, any>
    expect(props.at).toEqual(dateTime)
    expect(props.any).toEqual({})
  })
})
