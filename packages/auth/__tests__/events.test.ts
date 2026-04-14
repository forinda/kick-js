import { describe, it, expect, vi } from 'vitest'
import 'reflect-metadata'
import { AuthAdapter, ApiKeyStrategy, Public, type AuthStrategy } from '@forinda/kickjs-auth'
import { Controller, Get, Post } from '@forinda/kickjs'

describe('Auth Events', () => {
  const validStrategy: AuthStrategy = {
    name: 'test-key',
    validate: async (req) => {
      if (req.headers?.['x-api-key'] === 'valid') {
        return { id: '1', roles: ['user'] }
      }
      return null
    },
  }

  it('fires onAuthenticated on successful auth', async () => {
    const onAuthenticated = vi.fn()
    const adapter = new AuthAdapter({
      strategies: [validStrategy],
      defaultPolicy: 'protected',
      events: { onAuthenticated },
    })

    const handler = adapter.middleware!()[0].handler
    const req = {
      method: 'GET',
      path: '/test',
      baseUrl: '',
      headers: { 'x-api-key': 'valid' },
      ip: '1.2.3.4',
      url: '/test',
    }
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() }
    await handler(req, res, vi.fn())

    expect(onAuthenticated).toHaveBeenCalledWith(
      expect.objectContaining({
        user: { id: '1', roles: ['user'] },
        strategy: 'test-key',
        timestamp: expect.any(Date),
      }),
    )
  })

  it('fires onAuthFailed when no strategy matches', async () => {
    const onAuthFailed = vi.fn()
    const adapter = new AuthAdapter({
      strategies: [validStrategy],
      defaultPolicy: 'protected',
      events: { onAuthFailed },
    })

    const handler = adapter.middleware!()[0].handler
    const req = {
      method: 'GET',
      path: '/test',
      baseUrl: '',
      headers: {},
      ip: '1.2.3.4',
      url: '/test',
    }
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
    await handler(req, res, vi.fn())

    expect(onAuthFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'No strategy returned a user',
      }),
    )
  })

  it('fires onForbidden when role check fails', async () => {
    const onForbidden = vi.fn()

    @Controller()
    class AdminCtrl {
      @Get('/admin')
      admin() {}
    }

    // Use Roles metadata manually
    const { Roles } = await import('@forinda/kickjs-auth')

    @Controller()
    class RoledCtrl {
      @Get('/secret')
      @Roles('admin')
      secret() {}
    }

    const adapter = new AuthAdapter({
      strategies: [validStrategy],
      defaultPolicy: 'protected',
      events: { onForbidden },
    })
    adapter.onRouteMount!(RoledCtrl, '/api')

    const handler = adapter.middleware!()[0].handler
    const req = {
      method: 'GET',
      path: '/api/secret',
      baseUrl: '',
      headers: { 'x-api-key': 'valid' },
      ip: '1.2.3.4',
      url: '/api/secret',
    }
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() }
    await handler(req, res, vi.fn())

    expect(onForbidden).toHaveBeenCalledWith(
      expect.objectContaining({
        user: { id: '1', roles: ['user'] },
        requiredRoles: ['admin'],
        userRoles: ['user'],
      }),
    )
  })

  it('event handler error does not break auth flow', async () => {
    const onAuthenticated = vi.fn().mockRejectedValue(new Error('handler crash'))
    const adapter = new AuthAdapter({
      strategies: [validStrategy],
      defaultPolicy: 'protected',
      events: { onAuthenticated },
    })

    const handler = adapter.middleware!()[0].handler
    const req = {
      method: 'GET',
      path: '/test',
      baseUrl: '',
      headers: { 'x-api-key': 'valid' },
      ip: '1.2.3.4',
      url: '/test',
    }
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() }
    const next = vi.fn()

    // Should not throw
    await handler(req, res, next)
    expect(next).toHaveBeenCalled()
  })

  it('no events emitted for @Public() routes', async () => {
    const onAuthenticated = vi.fn()
    const onAuthFailed = vi.fn()

    @Controller()
    class PublicCtrl {
      @Get('/open')
      @Public()
      open() {}
    }

    const adapter = new AuthAdapter({
      strategies: [validStrategy],
      defaultPolicy: 'protected',
      events: { onAuthenticated, onAuthFailed },
    })
    adapter.onRouteMount!(PublicCtrl, '/api')

    const handler = adapter.middleware!()[0].handler
    const req = { method: 'GET', path: '/api/open', baseUrl: '', headers: {}, ip: '1.2.3.4' }
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
    await handler(req, res, vi.fn())

    expect(onAuthenticated).not.toHaveBeenCalled()
    expect(onAuthFailed).not.toHaveBeenCalled()
  })
})
