import { describe, it, expect } from 'vitest'
import * as v from 'valibot'
import { detectSchema } from '../src/index'
import { fromValibot } from '../src/adapters/valibot'

/** A Standard Schema the way ArkType ships one: a callable type that returns errors rather than throwing. */
function callableStandard() {
  const check = (value: unknown) => (typeof value === 'number' ? value : { arkErrors: true })
  return Object.assign(check, {
    '~standard': {
      version: 1,
      vendor: 'mock',
      validate: (value: unknown) =>
        typeof value === 'number'
          ? { value }
          : { issues: [{ message: 'must be a number', path: [] }] },
    },
  })
}

describe('detectSchema — Standard Schema fixes', () => {
  it('treats a callable Standard Schema as a schema, not a plain validator function', () => {
    const schema = detectSchema(callableStandard())
    expect(schema.safeParse(42)).toEqual({ success: true, data: 42 })
    expect(schema.safeParse('x')).toMatchObject({
      success: false,
      issues: [{ message: 'must be a number', code: 'validation' }],
    })
  })

  it('passes target and io to a Standard JSON Schema library', () => {
    const calls: unknown[] = []
    const make = (side: string) => (options: { target: string }) => {
      if (!options?.target) throw new Error('target required')
      calls.push([side, options.target])
      return { $schema: 'x', type: 'string', side }
    }
    const schema = detectSchema({
      '~standard': {
        version: 1,
        vendor: 'mock',
        validate: (value: unknown) => ({ value }),
        jsonSchema: { input: make('input'), output: make('output') },
      },
    })
    expect(schema.toJsonSchema({ target: 'openapi-3.0', io: 'input' })).toEqual({
      type: 'string',
      side: 'input',
    })
    expect(schema.toJsonSchema()).toEqual({ type: 'string', side: 'output' })
    expect(calls).toEqual([
      ['input', 'openapi-3.0'],
      ['output', 'draft-2020-12'],
    ])
  })
})

describe('fromValibot issue mapping', () => {
  it("leaves out an expected value Valibot reports as null, instead of the string 'null'", () => {
    const result = fromValibot(v.object({ email: v.pipe(v.string(), v.email()) })).safeParse({
      email: 'nope',
    })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.issues[0]).not.toHaveProperty('expected', 'null')
  })
})
