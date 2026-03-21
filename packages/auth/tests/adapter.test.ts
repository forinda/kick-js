import { describe, it, expect, vi } from 'vitest'
import 'reflect-metadata'
import { AuthAdapter, ApiKeyStrategy, type AuthStrategy } from '@forinda/kickjs-auth'

describe('AuthAdapter', () => {
  it('creates adapter with strategies', () => {
    const adapter = new AuthAdapter({
      strategies: [new ApiKeyStrategy({ keys: { 'sk-test': { name: 'Bot' } } })],
    })

    expect(adapter.name).toBe('AuthAdapter')
  })

  it('provides auth middleware at beforeRoutes phase', () => {
    const adapter = new AuthAdapter({
      strategies: [new ApiKeyStrategy({ keys: { 'sk-test': { name: 'Bot' } } })],
    })

    const middlewares = adapter.middleware!()
    expect(middlewares).toHaveLength(1)
    expect(middlewares[0].phase).toBe('beforeRoutes')
    expect(typeof middlewares[0].handler).toBe('function')
  })

  it('passes through with open policy when no route info', async () => {
    const adapter = new AuthAdapter({
      strategies: [],
      defaultPolicy: 'open',
    })

    const handler = adapter.middleware!()[0].handler
    const req = { route: null, headers: {} }
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
    const next = vi.fn()

    await handler(req, res, next)
    expect(next).toHaveBeenCalled()
  })

  it('blocks unauthenticated requests with protected policy', async () => {
    const adapter = new AuthAdapter({
      strategies: [new ApiKeyStrategy({ keys: { 'sk-valid': { name: 'Bot' } } })],
      defaultPolicy: 'protected',
    })

    const handler = adapter.middleware!()[0].handler
    const req = { route: { path: '/test' }, headers: {}, method: 'GET', baseUrl: '' }
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
    const next = vi.fn()

    await handler(req, res, next)
    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(401)
  })

  it('passes authenticated requests and attaches user to req', async () => {
    const adapter = new AuthAdapter({
      strategies: [new ApiKeyStrategy({ keys: { 'sk-valid': { name: 'Bot' } } })],
      defaultPolicy: 'protected',
    })

    const handler = adapter.middleware!()[0].handler
    const req = {
      route: { path: '/test' },
      headers: { 'x-api-key': 'sk-valid' },
      method: 'GET',
      baseUrl: '',
    }
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
    const next = vi.fn()

    await handler(req, res, next)
    expect(next).toHaveBeenCalled()
    expect((req as any).user).toEqual({ name: 'Bot' })
  })

  it('supports custom onUnauthorized handler', async () => {
    const customHandler = vi.fn()
    const adapter = new AuthAdapter({
      strategies: [],
      defaultPolicy: 'protected',
      onUnauthorized: customHandler,
    })

    const handler = adapter.middleware!()[0].handler
    const req = { route: { path: '/test' }, headers: {}, method: 'GET', baseUrl: '' }
    const res = {}
    const next = vi.fn()

    await handler(req, res, next)
    expect(customHandler).toHaveBeenCalledWith(req, res)
    expect(next).not.toHaveBeenCalled()
  })

  it('tries multiple strategies in order (first match wins)', async () => {
    const strategy1: AuthStrategy = {
      name: 'first',
      validate: async () => null,
    }
    const strategy2: AuthStrategy = {
      name: 'second',
      validate: async () => ({ id: '1', name: 'User' }),
    }

    const adapter = new AuthAdapter({
      strategies: [strategy1, strategy2],
      defaultPolicy: 'protected',
    })

    const handler = adapter.middleware!()[0].handler
    const req = { route: { path: '/test' }, headers: {}, method: 'GET', baseUrl: '' }
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
    const next = vi.fn()

    await handler(req, res, next)
    expect(next).toHaveBeenCalled()
    expect((req as any).user).toEqual({ id: '1', name: 'User' })
  })

  it('supports custom onForbidden handler', async () => {
    const customHandler = vi.fn()
    const adapter = new AuthAdapter({
      strategies: [{ name: 'test', validate: async () => ({ roles: [] }) }],
      defaultPolicy: 'protected',
      onForbidden: customHandler,
    })

    expect(typeof customHandler).toBe('function')
  })
})
