/**
 * `insertSchema` / `selectSchema` / `updateSchema`: a kick/db table as a
 * request validator and JSON Schema — the `KickSchema` contract validation,
 * Swagger and typegen consume.
 */
import { describe, expect, it } from 'vitest'
import { detectSchema } from '@forinda/kickjs-schema'

import {
  bigint,
  boolean,
  customType,
  date,
  decimal,
  numeric,
  integer,
  jsonb,
  serial,
  smallint,
  table,
  text,
  timestamptz,
  uuid,
  varchar,
} from '../../src/index'
import { pgEnum, vector } from '../../src/dsl/columns/pg'
import { insertSchema, selectSchema, updateSchema } from '../../src/schema'

const role = pgEnum('role', 'admin', 'member')
const users = table('users', {
  id: uuid().primaryKey().defaultRandom(),
  seq: serial(),
  email: varchar(120).notNull(),
  name: text(),
  role: role().notNull().default('member'),
  age: integer(),
  balance: decimal(10, 2).notNull().default('0'),
  visits: bigint(),
  active: boolean().notNull(),
  born: date(),
  createdAt: timestamptz().notNull().defaultNow(),
  tags: text().array(),
  meta: jsonb<{ theme: string }>(),
  embedding: vector(3),
})

const valid = { email: 'ada@example.com', active: true }

describe('insertSchema', () => {
  const schema = insertSchema(users)

  it('requires only the columns the database does not fill', () => {
    const missing = schema.safeParse({})
    expect(missing.success).toBe(false)
    if (!missing.success) {
      expect(missing.issues.map((i) => i.path[0]).toSorted()).toEqual(['active', 'email'])
    }
    expect(schema.safeParse(valid)).toEqual({ success: true, data: valid })
  })

  it('parses each column by its SQL type', () => {
    const result = schema.safeParse({
      ...valid,
      role: 'admin',
      age: 36,
      balance: 12.5,
      visits: '9007199254740993',
      born: '1815-12-10',
      tags: ['a', 'b'],
      meta: { theme: 'dark' },
      embedding: [0.1, 0.2, 0.3],
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.balance).toBe('12.5')
    expect(result.data.visits).toBe(9007199254740993n)
    expect(result.data.born).toBeInstanceOf(Date)
    expect(result.data.meta).toEqual({ theme: 'dark' })
  })

  it('reports every bad column with its path', () => {
    const result = schema.safeParse({
      email: 'x'.repeat(121),
      active: 'yes',
      role: 'owner',
      age: 1.5,
      balance: 'lots',
      born: 'not a date',
      tags: ['a', 2],
      embedding: [1, 2],
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(Object.fromEntries(result.issues.map((i) => [i.path[0], i.message]))).toEqual({
      email: 'Must be at most 120 characters',
      active: 'Expected a boolean',
      role: 'Expected one of admin, member',
      age: 'Expected an integer',
      balance: 'Expected a decimal number or string',
      born: 'Expected a date string',
      tags: '[1]: Expected a string',
      embedding: 'Expected 3 items',
    })
  })

  it('holds a decimal to its precision and scale', () => {
    const prices = table('prices', {
      amount: decimal(12, 2).notNull(),
      rate: decimal(2, 2),
      count: numeric(5),
      any: numeric(),
    })
    const parse = (row: Record<string, unknown>) => {
      const r = insertSchema(prices).safeParse({ amount: '1', ...row })
      return r.success ? r.data : r.issues.map((i) => `${String(i.path[0])}: ${i.message}`)
    }

    expect(
      parse({ amount: '9999999999.99', rate: '0.25', count: '-12345', any: '1.23456789' }),
    ).toEqual({ amount: '9999999999.99', rate: '0.25', count: '-12345', any: '1.23456789' })
    expect(parse({ amount: 19.99 })).toEqual({ amount: '19.99' })
    expect(parse({ amount: '1.234' })).toEqual([
      'amount: At most 2 digit(s) after the decimal point',
    ])
    expect(parse({ amount: '12345678901' })).toEqual([
      'amount: At most 10 digit(s) before the decimal point',
    ])
    expect(parse({ rate: '1.5' })).toEqual(['rate: At most 0 digit(s) before the decimal point'])
    expect(parse({ count: '1.5' })).toEqual(['count: At most 0 digit(s) after the decimal point'])
    // A scale outside 0…precision gets the plain decimal check; the database enforces the range.
    const odd = insertSchema(
      table('odd', { tiny: numeric(3, 5).notNull(), round: numeric(2, -3).notNull() }),
    )
    expect(odd.safeParse({ tiny: '0.00123', round: '12000' }).success).toBe(true)
    // 0.1 + 0.2 is 0.30000000000000004 — send exact amounts as strings.
    expect(parse({ amount: 0.1 + 0.2 })).toEqual([
      'amount: At most 2 digit(s) after the decimal point',
    ])
  })

  it('accepts null only for nullable columns, and drops unknown keys', () => {
    expect(schema.safeParse({ ...valid, name: null, isAdmin: true })).toEqual({
      success: true,
      data: { ...valid, name: null },
    })
    const result = schema.safeParse({ ...valid, email: null })
    expect(result.success).toBe(false)
  })

  it('applies column rules and whole-schema overrides', () => {
    const strict = insertSchema(users, {
      columns: {
        email: { format: 'email' },
        name: { minLength: 2 },
        age: { minimum: 0, maximum: 150 },
        // Any KickSchema replaces the column's rule — e.g. fromZod(...) for a json shape.
        meta: {
          safeParse: (v: unknown) =>
            (v as { theme?: unknown })?.theme === 'light' ||
            (v as { theme?: unknown })?.theme === 'dark'
              ? { success: true as const, data: v }
              : { success: false as const, issues: [{ message: 'Bad theme' }] },
          toJsonSchema: () => ({ type: 'object' }),
        },
      },
      omit: ['id', 'seq'],
    })
    const result = strict.safeParse({
      ...valid,
      email: 'nope',
      name: 'A',
      age: 200,
      meta: { theme: 'blue' },
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.issues.map((i) => i.path[0]).toSorted()).toEqual([
        'age',
        'email',
        'meta',
        'name',
      ])
    }
    expect(strict.safeParse({ ...valid, id: 'x' })).toEqual({ success: true, data: valid })
  })
})

describe('selectSchema and updateSchema', () => {
  it('select requires every column, allowing null where nullable', () => {
    const schema = selectSchema(users, { omit: ['embedding', 'meta', 'tags'] })
    expect(schema.safeParse(valid).success).toBe(false)
    const row = {
      id: '0b6e1c3a-5f3e-4c1a-9b8e-2f1d6c7a8b9c',
      seq: 1,
      email: 'ada@example.com',
      name: null,
      role: 'member',
      age: null,
      balance: '0',
      visits: null,
      active: true,
      born: null,
      createdAt: '2026-09-30T10:00:00Z',
    }
    const result = schema.safeParse(row)
    expect(result.success).toBe(true)
  })

  it('update makes every column optional', () => {
    expect(updateSchema(users).safeParse({})).toEqual({ success: true, data: {} })
    expect(updateSchema(users).safeParse({ age: 'x' }).success).toBe(false)
  })

  it('leaves custom and json columns unchecked unless overridden', () => {
    const point = customType<{ x: number }>({ dataType: () => 'point' })
    const places = table('places', { at: point().notNull() })
    expect(insertSchema(places).safeParse({ at: 'anything' }).success).toBe(true)
  })
})

describe('JSON Schema', () => {
  it('describes each column, required list and nullability per target', () => {
    const schema = insertSchema(users, { columns: { email: { format: 'email' } } })
    const openapi = schema.toJsonSchema({ target: 'openapi-3.0' }) as {
      properties: Record<string, Record<string, unknown>>
      required: string[]
    }
    expect(openapi.required.toSorted()).toEqual(['active', 'email'])
    expect(openapi.properties.email).toEqual({ type: 'string', maxLength: 120, format: 'email' })
    expect(openapi.properties.role).toEqual({ type: 'string', enum: ['admin', 'member'] })
    expect(openapi.properties.age).toEqual({
      type: 'integer',
      minimum: -2147483648,
      maximum: 2147483647,
      nullable: true,
    })
    expect(openapi.properties.createdAt).toEqual({ type: 'string', format: 'date-time' })
    expect(openapi.properties.embedding).toMatchObject({ type: 'array', minItems: 3, maxItems: 3 })

    const draft = schema.toJsonSchema() as { properties: Record<string, unknown> }
    expect(draft.properties.age).toEqual({
      anyOf: [{ type: 'integer', minimum: -2147483648, maximum: 2147483647 }, { type: 'null' }],
    })
  })
})

describe('integer ranges', () => {
  const counters = table('counters', {
    id: serial(),
    small: smallint(),
    normal: integer(),
    big: bigint(),
  })
  const schema = insertSchema(counters)

  it('rejects values the column cannot store, instead of a database error', () => {
    const result = schema.safeParse({
      id: 0,
      small: 40_000,
      normal: 2 ** 40,
      big: '9223372036854775808',
    })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(Object.fromEntries(result.issues.map((i) => [i.path[0], i.message]))).toEqual({
      id: 'Must be between 1 and 2147483647',
      small: 'Must be between -32768 and 32767',
      normal: 'Must be between -2147483648 and 2147483647',
      big: 'Out of range for a 64-bit integer',
    })
    expect(
      schema.safeParse({ small: -32768, normal: 2147483647, big: '-9223372036854775808' }).success,
    ).toBe(true)
  })
})

describe('whole-schema overrides', () => {
  it('render in the JSON Schema target the caller asks for', () => {
    const targets: unknown[] = []
    const schema = insertSchema(users, {
      columns: {
        meta: {
          safeParse: (v: unknown) => ({ success: true as const, data: v }),
          toJsonSchema: (options?: { target?: string }) => {
            targets.push(options?.target)
            return { type: 'object', 'x-target': options?.target ?? 'default' }
          },
        },
      },
    })
    const draft = schema.toJsonSchema({ target: 'draft-07' }) as {
      properties: Record<string, unknown>
    }
    expect(draft.properties.meta).toEqual({
      anyOf: [{ type: 'object', 'x-target': 'draft-07' }, { type: 'null' }],
    })
    const openapi = schema.toJsonSchema({ target: 'openapi-3.0' }) as {
      properties: Record<string, unknown>
    }
    expect(openapi.properties.meta).toEqual({
      type: 'object',
      'x-target': 'openapi-3.0',
      nullable: true,
    })
  })
})

describe('as a KickSchema and a Standard Schema', () => {
  it('is used as-is by detectSchema — validation, Swagger and MCP take it directly', () => {
    const schema = insertSchema(users)
    expect(detectSchema(schema)).toBe(schema)
  })

  it('validates through ~standard', () => {
    const standard = insertSchema(users)['~standard']
    expect(standard.vendor).toBe('kickjs-db')
    expect(standard.validate(valid)).toEqual({ value: valid })
    expect(standard.validate({})).toMatchObject({
      issues: [{ path: ['email'] }, { path: ['active'] }],
    })
  })
})
