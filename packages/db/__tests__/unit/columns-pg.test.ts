import { describe, it, expect } from 'vitest'
import { tsvector, vector, citext, money, inet, cidr, xml } from '@forinda/kickjs-db/pg'

describe('PG-only column types (subpath import)', () => {
  it('vector(384)', () => {
    expect(vector(384).toJSON('embedding').type).toBe('vector(384)')
  })

  it('vector() unbounded', () => {
    expect(vector().toJSON('embedding').type).toBe('vector')
  })

  it('citext / money / inet / cidr / xml / tsvector', () => {
    expect(citext().toJSON('x').type).toBe('citext')
    expect(money().toJSON('x').type).toBe('money')
    expect(inet().toJSON('x').type).toBe('inet')
    expect(cidr().toJSON('x').type).toBe('cidr')
    expect(xml().toJSON('x').type).toBe('xml')
    expect(tsvector().toJSON('x').type).toBe('tsvector')
  })
})
