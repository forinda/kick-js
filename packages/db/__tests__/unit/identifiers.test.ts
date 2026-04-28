import { describe, it, expect } from 'vitest'
import { quoteIdent, quoteLiteral } from '../../src/emit/identifiers'

describe('quoteIdent', () => {
  it('wraps in double quotes', () => {
    expect(quoteIdent('users')).toBe('"users"')
  })

  it('escapes embedded double quotes', () => {
    expect(quoteIdent('we"ird')).toBe('"we""ird"')
  })

  it('handles dotted refs by quoting each segment', () => {
    expect(quoteIdent('public.users')).toBe('"public"."users"')
  })
})

describe('quoteLiteral', () => {
  it('wraps in single quotes', () => {
    expect(quoteLiteral('hello')).toBe("'hello'")
  })

  it('escapes single quotes', () => {
    expect(quoteLiteral("it's")).toBe("'it''s'")
  })
})
