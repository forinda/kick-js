import { describe, it, expect, vi } from 'vitest'
import 'reflect-metadata'
import { AuthAdapter } from '@forinda/kickjs-auth'

describe('AuthAdapter.testMode()', () => {
  it('creates an adapter that always returns the given user', async () => {
    const testUser = { id: 'test-1', email: 'test@test.com', roles: ['admin'] }
    const adapter = AuthAdapter.testMode({ user: testUser, defaultPolicy: 'protected' })

    expect(adapter.name).toBe('AuthAdapter')

    const handler = adapter.middleware!()[0].handler
    const req = { method: 'GET', path: '/test', baseUrl: '', headers: {}, ip: '1.1.1.1', url: '/test' }
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() }
    const next = vi.fn()

    await handler(req, res, next)
    expect(next).toHaveBeenCalled()
    expect((req as any).user).toEqual(testUser)
  })

  it('defaults to open policy', () => {
    const adapter = AuthAdapter.testMode({ user: { id: '1' } })
    const handler = adapter.middleware!()[0].handler

    // Open policy means unmatched routes pass through
    const req = { method: 'GET', path: '/unknown', baseUrl: '', headers: {}, ip: '1.1.1.1', url: '/unknown' }
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
    const next = vi.fn()

    handler(req, res, next)
    // With open policy and no route match, should pass through
    expect(next).toHaveBeenCalled()
  })

  it('supports custom defaultPolicy', async () => {
    const adapter = AuthAdapter.testMode({
      user: { id: '1' },
      defaultPolicy: 'protected',
    })

    const handler = adapter.middleware!()[0].handler
    const req = { method: 'GET', path: '/test', baseUrl: '', headers: {}, ip: '1.1.1.1', url: '/test' }
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() }
    const next = vi.fn()

    await handler(req, res, next)
    // Protected policy, test strategy always authenticates
    expect(next).toHaveBeenCalled()
    expect((req as any).user).toEqual({ id: '1' })
  })
})
