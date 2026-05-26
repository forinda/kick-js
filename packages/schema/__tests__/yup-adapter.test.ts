import { describe, it, expect } from 'vitest'
import * as yup from 'yup'
import { fromYup, yupAdapter } from '../src/adapters/yup'
import { detectSchema, isKickSchema } from '../src/detect'

describe('fromYup() — Yup adapter', () => {
  const UserSchema = yup.object({
    name: yup.string().required('Name is required').min(1),
    email: yup.string().required().email('Invalid email'),
    age: yup.number().required().integer().min(18, 'Must be 18 or older'),
  })

  it('wraps a Yup schema into KickSchema', () => {
    const schema = fromYup(UserSchema)
    expect(schema).toBeDefined()
    expect(typeof schema.safeParse).toBe('function')
    expect(typeof schema.toJsonSchema).toBe('function')
    expect(schema._raw).toBe(UserSchema)
  })

  it('validates valid input successfully', () => {
    const schema = fromYup(UserSchema)
    const result = schema.safeParse({ name: 'Alice', email: 'alice@test.com', age: 25 })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual({ name: 'Alice', email: 'alice@test.com', age: 25 })
    }
  })

  it('returns structured issues for invalid input', () => {
    const schema = fromYup(UserSchema)
    const result = schema.safeParse({ name: '', email: 'bad', age: 12 })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.issues.length).toBeGreaterThanOrEqual(2)

      const emailIssue = result.issues.find((i) => i.path[0] === 'email')
      expect(emailIssue).toBeDefined()
      expect(emailIssue!.message).toBe('Invalid email')

      const ageIssue = result.issues.find((i) => i.path[0] === 'age')
      expect(ageIssue).toBeDefined()
      expect(ageIssue!.message).toBe('Must be 18 or older')
    }
  })

  it('handles missing required fields', () => {
    const schema = fromYup(UserSchema)
    const result = schema.safeParse({})
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.issues.length).toBeGreaterThanOrEqual(3)
      for (const issue of result.issues) {
        expect(issue.message).toBeTruthy()
        expect(issue.code).toBeTruthy()
      }
    }
  })

  it('handles nested object validation', () => {
    const nested = yup.object({
      user: yup.object({
        address: yup.object({
          zip: yup.string().required().min(5, 'ZIP too short'),
        }),
      }),
    })
    const schema = fromYup(nested)
    const result = schema.safeParse({ user: { address: { zip: '12' } } })
    expect(result.success).toBe(false)
    if (!result.success) {
      const issue = result.issues[0]
      expect(issue.path).toEqual(['user', 'address', 'zip'])
      expect(issue.message).toBe('ZIP too short')
    }
  })

  it('preserves Yup defaults', () => {
    const schema = fromYup(
      yup.object({
        count: yup.number().default(10),
        active: yup.boolean().default(true),
      }),
    )
    const result = schema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual({ count: 10, active: true })
    }
  })

  it('generates JSON Schema via toJsonSchema()', () => {
    const schema = fromYup(UserSchema)
    const jsonSchema = schema.toJsonSchema()
    expect(jsonSchema.type).toBe('object')
    expect(jsonSchema.properties).toBeDefined()
    expect((jsonSchema.properties as any).name).toBeDefined()
    expect((jsonSchema.properties as any).email).toBeDefined()
    expect((jsonSchema.properties as any).age).toBeDefined()
  })

  it('maps expected on min/max issues', () => {
    const schema = fromYup(yup.number().required().min(10))
    const result = schema.safeParse(3)
    expect(result.success).toBe(false)
    if (!result.success) {
      const issue = result.issues[0]
      expect(issue.code).toBe('min')
      expect(issue.expected).toBe('>=10')
    }
  })

  it('handles oneOf/enum validation', () => {
    const schema = fromYup(yup.string().required().oneOf(['a', 'b', 'c']))
    const result = schema.safeParse('d')
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.issues[0].code).toBeTruthy()
      expect(result.issues[0].message).toBeTruthy()
    }
  })

  it('handles array item validation', () => {
    const schema = fromYup(yup.array().of(yup.string().required().min(2)))
    const result = schema.safeParse(['a', 'ok', 'b'])
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.issues.length).toBeGreaterThanOrEqual(1)
    }
  })
})

describe('yupAdapter', () => {
  it('detects Yup schemas', () => {
    const schema = yup.object({ name: yup.string() })
    expect(yupAdapter.detect(schema)).toBe(true)
  })

  it('rejects non-Yup objects', () => {
    expect(yupAdapter.detect({})).toBe(false)
    expect(yupAdapter.detect(null)).toBe(false)
    expect(yupAdapter.detect('string')).toBe(false)
    expect(yupAdapter.detect(42)).toBe(false)
  })

  it('wraps via yupAdapter.wrap()', () => {
    const raw = yup.string().email()
    const schema = yupAdapter.wrap(raw)
    expect(schema._raw).toBe(raw)
    const result = schema.safeParse('hello@test.com')
    expect(result.success).toBe(true)
  })
})

describe('detectSchema() — Yup auto-detection', () => {
  it('auto-detects Yup schemas', () => {
    const yupSchema = yup.object({ x: yup.number().required() })
    const wrapped = detectSchema(yupSchema)
    expect(isKickSchema(wrapped)).toBe(true)
    expect(wrapped._raw).toBe(yupSchema)

    const valid = wrapped.safeParse({ x: 42 })
    expect(valid.success).toBe(true)

    const invalid = wrapped.safeParse({ x: 'nope' })
    expect(invalid.success).toBe(false)
  })

  it('generates JSON Schema from auto-detected Yup schema', () => {
    const yupSchema = yup.object({
      title: yup.string().required(),
      count: yup.number().required(),
    })
    const wrapped = detectSchema(yupSchema)
    const jsonSchema = wrapped.toJsonSchema()
    expect(jsonSchema.type).toBe('object')
    expect((jsonSchema.properties as any).title).toBeDefined()
    expect((jsonSchema.properties as any).count).toBeDefined()
  })
})
