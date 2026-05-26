import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { fromZod, zodAdapter } from '../src/adapters/zod'
import { detectSchema, isKickSchema, registerAdapter } from '../src/detect'
import type { KickSchema } from '../src/types'

describe('fromZod() — Zod adapter', () => {
  const UserSchema = z.object({
    name: z.string().min(1, 'Name is required'),
    email: z.string().email('Invalid email'),
    age: z.number().int().min(18, 'Must be 18 or older'),
  })

  it('wraps a Zod schema into KickSchema', () => {
    const schema = fromZod(UserSchema)
    expect(schema).toBeDefined()
    expect(typeof schema.safeParse).toBe('function')
    expect(typeof schema.toJsonSchema).toBe('function')
    expect(schema._raw).toBe(UserSchema)
  })

  it('validates valid input successfully', () => {
    const schema = fromZod(UserSchema)
    const result = schema.safeParse({ name: 'Alice', email: 'alice@test.com', age: 25 })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual({ name: 'Alice', email: 'alice@test.com', age: 25 })
    }
  })

  it('returns structured issues for invalid input', () => {
    const schema = fromZod(UserSchema)
    const result = schema.safeParse({ name: '', email: 'bad', age: 12 })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.issues.length).toBeGreaterThanOrEqual(3)

      const nameIssue = result.issues.find((i) => i.path[0] === 'name')
      expect(nameIssue).toBeDefined()
      expect(nameIssue!.message).toBe('Name is required')
      expect(nameIssue!.code).toBe('too_small')

      const emailIssue = result.issues.find((i) => i.path[0] === 'email')
      expect(emailIssue).toBeDefined()
      expect(emailIssue!.message).toBe('Invalid email')

      const ageIssue = result.issues.find((i) => i.path[0] === 'age')
      expect(ageIssue).toBeDefined()
      expect(ageIssue!.message).toBe('Must be 18 or older')
      expect(ageIssue!.code).toBe('too_small')
      expect(ageIssue!.expected).toBe('>=18')
    }
  })

  it('handles missing required fields', () => {
    const schema = fromZod(UserSchema)
    const result = schema.safeParse({})
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.issues.length).toBeGreaterThanOrEqual(3)
      for (const issue of result.issues) {
        expect(issue.path.length).toBe(1)
        expect(issue.message).toBeTruthy()
        expect(issue.code).toBeTruthy()
      }
    }
  })

  it('handles nested object validation', () => {
    const nested = z.object({
      user: z.object({
        address: z.object({
          zip: z.string().min(5, 'ZIP too short'),
        }),
      }),
    })
    const schema = fromZod(nested)
    const result = schema.safeParse({ user: { address: { zip: '12' } } })
    expect(result.success).toBe(false)
    if (!result.success) {
      const issue = result.issues[0]
      expect(issue.path).toEqual(['user', 'address', 'zip'])
      expect(issue.message).toBe('ZIP too short')
    }
  })

  it('preserves Zod transforms and defaults', () => {
    const schema = fromZod(
      z.object({
        count: z.coerce.number().default(10),
        active: z.boolean().default(true),
      }),
    )
    const result = schema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual({ count: 10, active: true })
    }
  })

  it('generates JSON Schema via toJsonSchema()', () => {
    const schema = fromZod(UserSchema)
    const jsonSchema = schema.toJsonSchema()
    expect(jsonSchema.type).toBe('object')
    expect(jsonSchema.properties).toBeDefined()
    expect((jsonSchema.properties as any).name).toBeDefined()
    expect((jsonSchema.properties as any).email).toBeDefined()
    expect((jsonSchema.properties as any).age).toBeDefined()
    expect(jsonSchema.$schema).toBeUndefined()
  })

  it('returns fallback JSON Schema for schemas without .toJSONSchema()', () => {
    const fakeSchema = {
      safeParse: () => ({ success: true, data: {} }),
      _def: {},
    }
    const schema = fromZod(fakeSchema)
    const jsonSchema = schema.toJsonSchema()
    expect(jsonSchema).toEqual({ type: 'object' })
  })
})

describe('zodAdapter', () => {
  it('detects Zod schemas', () => {
    const zodSchema = z.object({ name: z.string() })
    expect(zodAdapter.detect(zodSchema)).toBe(true)
  })

  it('rejects non-Zod objects', () => {
    expect(zodAdapter.detect({})).toBe(false)
    expect(zodAdapter.detect(null)).toBe(false)
    expect(zodAdapter.detect('string')).toBe(false)
    expect(zodAdapter.detect(42)).toBe(false)
    expect(zodAdapter.detect({ safeParse: () => {} })).toBe(false)
  })

  it('wraps via zodAdapter.wrap()', () => {
    const raw = z.string().email()
    const schema = zodAdapter.wrap(raw)
    expect(schema._raw).toBe(raw)
    const result = schema.safeParse('hello@test.com')
    expect(result.success).toBe(true)
  })
})

describe('detectSchema() — auto-detection', () => {
  it('passes through an existing KickSchema', () => {
    const kick: KickSchema<string> = {
      safeParse: (d) => ({ success: true, data: d as string }),
      toJsonSchema: () => ({ type: 'string' }),
    }
    expect(detectSchema(kick)).toBe(kick)
  })

  it('auto-detects Zod schemas', () => {
    const zodSchema = z.object({ x: z.number() })
    const wrapped = detectSchema(zodSchema)
    expect(isKickSchema(wrapped)).toBe(true)
    expect(wrapped._raw).toBe(zodSchema)

    const result = wrapped.safeParse({ x: 42 })
    expect(result.success).toBe(true)
  })

  it('auto-detects Standard Schema v1 objects', () => {
    const standardSchema = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: (value: unknown) => {
          if (typeof value === 'string') return { value }
          return { issues: [{ message: 'Expected string' }] }
        },
      },
    }

    const wrapped = detectSchema(standardSchema)
    expect(wrapped.safeParse('hello')).toEqual({ success: true, data: 'hello' })

    const fail = wrapped.safeParse(42)
    expect(fail.success).toBe(false)
    if (!fail.success) {
      expect(fail.issues[0].message).toBe('Expected string')
      expect(fail.issues[0].code).toBe('validation')
    }
  })

  it('wraps plain validator functions', () => {
    const validator = (data: unknown) => {
      if (typeof data !== 'number') throw new Error('Expected a number')
      return data
    }

    const wrapped = detectSchema(validator)
    expect(wrapped.safeParse(42)).toEqual({ success: true, data: 42 })

    const fail = wrapped.safeParse('nope')
    expect(fail.success).toBe(false)
    if (!fail.success) {
      expect(fail.issues[0].message).toBe('Expected a number')
      expect(fail.issues[0].code).toBe('custom')
    }
  })

  it('throws for unrecognized schemas', () => {
    expect(() => detectSchema({})).toThrow('Unrecognized schema')
    expect(() => detectSchema(42)).toThrow('Unrecognized schema')
    expect(() => detectSchema('string')).toThrow('Unrecognized schema')
  })

  it('supports custom adapters via registerAdapter()', () => {
    class FancySchema {
      constructor(public readonly type: string) {}
      check(data: unknown): boolean {
        return typeof data === this.type
      }
    }

    registerAdapter({
      name: 'fancy',
      detect: (s) => s instanceof FancySchema,
      wrap: (s) => {
        const fancy = s as FancySchema
        return {
          safeParse(data: unknown) {
            if (fancy.check(data)) return { success: true as const, data }
            return {
              success: false as const,
              issues: [{ path: [], message: `Expected ${fancy.type}`, code: 'type' }],
            }
          },
          toJsonSchema: () => ({ type: fancy.type }),
          _raw: s,
        }
      },
    })

    const fancy = new FancySchema('string')
    const wrapped = detectSchema(fancy)
    expect(wrapped.safeParse('hello')).toEqual({ success: true, data: 'hello' })

    const fail = wrapped.safeParse(42)
    expect(fail.success).toBe(false)
  })
})

describe('isKickSchema()', () => {
  it('returns true for valid KickSchema objects', () => {
    const schema: KickSchema = {
      safeParse: () => ({ success: true, data: null }),
      toJsonSchema: () => ({}),
    }
    expect(isKickSchema(schema)).toBe(true)
  })

  it('returns false for objects missing methods', () => {
    expect(isKickSchema({})).toBe(false)
    expect(isKickSchema({ safeParse: () => {} })).toBe(false)
    expect(isKickSchema({ toJsonSchema: () => {} })).toBe(false)
    expect(isKickSchema(null)).toBe(false)
  })
})

describe('SchemaIssue — error normalization', () => {
  it('normalizes too_small issues with expected', () => {
    const schema = fromZod(z.number().min(10))
    const result = schema.safeParse(3)
    expect(result.success).toBe(false)
    if (!result.success) {
      const issue = result.issues[0]
      expect(issue.code).toBe('too_small')
      expect(issue.expected).toBe('>=10')
    }
  })

  it('normalizes too_big issues with expected', () => {
    const schema = fromZod(z.number().max(100))
    const result = schema.safeParse(200)
    expect(result.success).toBe(false)
    if (!result.success) {
      const issue = result.issues[0]
      expect(issue.code).toBe('too_big')
      expect(issue.expected).toBe('<=100')
    }
  })

  it('normalizes enum issues', () => {
    const schema = fromZod(z.enum(['a', 'b', 'c']))
    const result = schema.safeParse('d')
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.issues[0].code).toBeTruthy()
      expect(result.issues[0].message).toBeTruthy()
    }
  })

  it('handles array item validation', () => {
    const schema = fromZod(z.array(z.string()))
    const result = schema.safeParse([1, 'ok', 3])
    expect(result.success).toBe(false)
    if (!result.success) {
      const paths = result.issues.map((i) => i.path)
      expect(paths).toContainEqual(['0'])
      expect(paths).toContainEqual(['2'])
    }
  })
})
