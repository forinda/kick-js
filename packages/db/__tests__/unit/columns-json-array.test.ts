import { describe, it, expect } from 'vitest'
import { json, jsonb, bytea, integer, varchar } from '@forinda/kickjs-db'

describe('json/jsonb/bytea + array', () => {
  it('json column with phantom type parameter', () => {
    const col = json<{ tags: string[] }>().toJSON('meta')
    expect(col.type).toBe('json')
  })

  it('jsonb column', () => {
    expect(jsonb<{ x: number }>().toJSON('m').type).toBe('jsonb')
  })

  it('bytea column', () => {
    expect(bytea().toJSON('blob').type).toBe('bytea')
  })

  it('integer().array() yields integer[]', () => {
    expect(integer().array().toJSON('xs').type).toBe('integer[]')
  })

  it('varchar(255).array() yields varchar(255)[]', () => {
    expect(varchar(255).array().toJSON('xs').type).toBe('varchar(255)[]')
  })
})
