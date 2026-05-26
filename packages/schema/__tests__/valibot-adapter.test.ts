import { describe, it, expect } from 'vitest'
import * as v from 'valibot'
import { fromValibot, valibotAdapter } from '../src/adapters/valibot'
import { detectSchema, isKickSchema } from '../src/detect'

describe('fromValibot() — Valibot adapter', () => {
  const UserSchema = v.object({
    name: v.pipe(v.string(), v.minLength(1, 'Name is required')),
    email: v.pipe(v.string(), v.email('Invalid email')),
    age: v.pipe(v.number(), v.integer(), v.minValue(18, 'Must be 18 or older')),
  })

  it('wraps a Valibot schema into KickSchema', () => {
    const schema = fromValibot(UserSchema)
    expect(schema).toBeDefined()
    expect(typeof schema.safeParse).toBe('function')
    expect(typeof schema.toJsonSchema).toBe('function')
    expect(schema._raw).toBe(UserSchema)
  })

  it('validates valid input successfully', () => {
    const schema = fromValibot(UserSchema)
    const result = schema.safeParse({ name: 'Alice', email: 'alice@test.com', age: 25 })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual({ name: 'Alice', email: 'alice@test.com', age: 25 })
    }
  })

  it('returns structured issues for invalid input', () => {
    const schema = fromValibot(UserSchema)
    const result = schema.safeParse({ name: '', email: 'bad', age: 12 })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.issues.length).toBeGreaterThanOrEqual(3)

      const nameIssue = result.issues.find((i) => i.path[0] === 'name')
      expect(nameIssue).toBeDefined()
      expect(nameIssue!.message).toBe('Name is required')

      const emailIssue = result.issues.find((i) => i.path[0] === 'email')
      expect(emailIssue).toBeDefined()
      expect(emailIssue!.message).toBe('Invalid email')

      const ageIssue = result.issues.find((i) => i.path[0] === 'age')
      expect(ageIssue).toBeDefined()
      expect(ageIssue!.message).toBe('Must be 18 or older')
    }
  })

  it('handles missing required fields', () => {
    const schema = fromValibot(UserSchema)
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
    const nested = v.object({
      user: v.object({
        address: v.object({
          zip: v.pipe(v.string(), v.minLength(5, 'ZIP too short')),
        }),
      }),
    })
    const schema = fromValibot(nested)
    const result = schema.safeParse({ user: { address: { zip: '12' } } })
    expect(result.success).toBe(false)
    if (!result.success) {
      const issue = result.issues[0]
      expect(issue.path).toEqual(['user', 'address', 'zip'])
      expect(issue.message).toBe('ZIP too short')
    }
  })

  it('preserves Valibot defaults and transforms', () => {
    const schema = fromValibot(
      v.object({
        count: v.optional(v.number(), 10),
        active: v.optional(v.boolean(), true),
      }),
    )
    const result = schema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual({ count: 10, active: true })
    }
  })

  it('generates JSON Schema via toJsonSchema()', () => {
    const schema = fromValibot(UserSchema)
    const jsonSchema = schema.toJsonSchema()
    expect(jsonSchema.type).toBe('object')
    expect(jsonSchema.properties).toBeDefined()
    expect((jsonSchema.properties as any).name).toBeDefined()
    expect((jsonSchema.properties as any).email).toBeDefined()
    expect((jsonSchema.properties as any).age).toBeDefined()
    expect(jsonSchema.$schema).toBeUndefined()
  })

  it('maps expected/received on issues', () => {
    const schema = fromValibot(v.pipe(v.number(), v.minValue(10)))
    const result = schema.safeParse(3)
    expect(result.success).toBe(false)
    if (!result.success) {
      const issue = result.issues[0]
      expect(issue.expected).toBeDefined()
      expect(issue.received).toBeDefined()
    }
  })

  it('handles enum/picklist validation', () => {
    const schema = fromValibot(v.picklist(['a', 'b', 'c']))
    const result = schema.safeParse('d')
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.issues[0].code).toBeTruthy()
      expect(result.issues[0].message).toBeTruthy()
    }
  })

  it('handles array item validation', () => {
    const schema = fromValibot(v.array(v.string()))
    const result = schema.safeParse([1, 'ok', 3])
    expect(result.success).toBe(false)
    if (!result.success) {
      const paths = result.issues.map((i) => i.path)
      expect(paths).toContainEqual(['0'])
      expect(paths).toContainEqual(['2'])
    }
  })
})

describe('valibotAdapter', () => {
  it('detects Valibot schemas', () => {
    const schema = v.object({ name: v.string() })
    expect(valibotAdapter.detect(schema)).toBe(true)
  })

  it('rejects non-Valibot objects', () => {
    expect(valibotAdapter.detect({})).toBe(false)
    expect(valibotAdapter.detect(null)).toBe(false)
    expect(valibotAdapter.detect('string')).toBe(false)
    expect(valibotAdapter.detect(42)).toBe(false)
  })

  it('wraps via valibotAdapter.wrap()', () => {
    const raw = v.pipe(v.string(), v.email())
    const schema = valibotAdapter.wrap(raw)
    expect(schema._raw).toBe(raw)
    const result = schema.safeParse('hello@test.com')
    expect(result.success).toBe(true)
  })
})

describe('detectSchema() — Valibot auto-detection', () => {
  it('auto-detects Valibot schemas', () => {
    const valibotSchema = v.object({ x: v.number() })
    const wrapped = detectSchema(valibotSchema)
    expect(isKickSchema(wrapped)).toBe(true)
    expect(wrapped._raw).toBe(valibotSchema)

    const valid = wrapped.safeParse({ x: 42 })
    expect(valid.success).toBe(true)

    const invalid = wrapped.safeParse({ x: 'nope' })
    expect(invalid.success).toBe(false)
  })

  it('generates JSON Schema from auto-detected Valibot schema', () => {
    const valibotSchema = v.object({
      title: v.pipe(v.string(), v.minLength(1)),
      count: v.number(),
    })
    const wrapped = detectSchema(valibotSchema)
    const jsonSchema = wrapped.toJsonSchema()
    expect(jsonSchema.type).toBe('object')
    expect((jsonSchema.properties as any).title).toBeDefined()
    expect((jsonSchema.properties as any).count).toBeDefined()
  })
})
