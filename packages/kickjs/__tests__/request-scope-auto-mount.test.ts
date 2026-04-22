import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { requestScopeMiddleware } from '../src/http/middleware/request-scope'
import { isRequestScopeMiddleware } from '../src/http/middleware/request-scope'

describe('requestScopeMiddleware — marker for auto-mount detection', () => {
  it('isRequestScopeMiddleware returns true for the function it produced', () => {
    const mw = requestScopeMiddleware()
    expect(isRequestScopeMiddleware(mw)).toBe(true)
  })

  it('returns true for distinct calls — every produced function is marked', () => {
    expect(isRequestScopeMiddleware(requestScopeMiddleware())).toBe(true)
    expect(isRequestScopeMiddleware(requestScopeMiddleware())).toBe(true)
  })

  it('returns false for unrelated middleware', () => {
    const otherMw = (_req: unknown, _res: unknown, next: () => void) => next()
    expect(isRequestScopeMiddleware(otherMw)).toBe(false)
  })

  it('returns false for non-function values', () => {
    expect(isRequestScopeMiddleware(null)).toBe(false)
    expect(isRequestScopeMiddleware(undefined)).toBe(false)
    expect(isRequestScopeMiddleware({})).toBe(false)
    expect(isRequestScopeMiddleware('string')).toBe(false)
    expect(isRequestScopeMiddleware(42)).toBe(false)
  })
})
