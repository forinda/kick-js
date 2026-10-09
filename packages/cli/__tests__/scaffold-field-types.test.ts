import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { parseFields } from '../src/generators/scaffold'

describe('scaffold field types', () => {
  it('emits Zod 4 top-level string formats, not the deprecated z.string() methods', () => {
    const fields = parseFields(['at:date', 'mail:email', 'site:url', 'ref:uuid'])
    expect(fields.map((f) => f.zodType)).toEqual([
      'z.iso.datetime()',
      'z.email()',
      'z.url()',
      'z.uuid()',
    ])
    // The emitted expressions are real Zod 4 schemas.
    const schema = (expr: string) => new Function('z', `return ${expr}`)(z) as z.ZodType
    expect(schema('z.iso.datetime()').safeParse('2026-10-09T10:00:00Z').success).toBe(true)
    expect(schema('z.email()').safeParse('a@b.io').success).toBe(true)
    expect(schema('z.url()').safeParse('https://x.io').success).toBe(true)
    expect(schema('z.uuid()').safeParse('nope').success).toBe(false)
  })
})
