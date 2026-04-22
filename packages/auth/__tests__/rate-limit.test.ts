import { describe, it, expect, vi } from 'vitest'
import 'reflect-metadata'
import { AuthAdapter, RateLimit, type AuthStrategy } from '@forinda/kickjs-auth'
import { Controller, Get, Post } from '@forinda/kickjs'

const alwaysAuthStrategy: AuthStrategy = {
  name: 'test',
  validate: async () => ({ id: 'user-1', roles: ['user'] }),
}

describe('@RateLimit decorator', () => {
  it('allows requests within the limit', async () => {
    @Controller()
    class TestCtrl {
      @Get('/search')
      @RateLimit({ windowMs: 60_000, max: 3 })
      search() {}
    }

    const adapter = AuthAdapter({
      strategies: [alwaysAuthStrategy],
      defaultPolicy: 'protected',
    })
    adapter.onRouteMount!(TestCtrl, '/api')

    const handler = adapter.middleware!()[0].handler

    for (let i = 0; i < 3; i++) {
      const req = {
        method: 'GET',
        path: '/api/search',
        baseUrl: '',
        headers: { authorization: 'Bearer test' },
        ip: '1.2.3.4',
      }
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
        setHeader: vi.fn(),
      }
      const next = vi.fn()

      await handler(req, res, next)
      expect(next).toHaveBeenCalled()
    }
  })

  it('blocks requests exceeding the limit with 429', async () => {
    @Controller()
    class LimitCtrl {
      @Get('/limited')
      @RateLimit({ windowMs: 60_000, max: 2 })
      limited() {}
    }

    const adapter = AuthAdapter({
      strategies: [alwaysAuthStrategy],
      defaultPolicy: 'protected',
    })
    adapter.onRouteMount!(LimitCtrl, '/api')

    const handler = adapter.middleware!()[0].handler

    const makeReq = () => ({
      method: 'GET',
      path: '/api/limited',
      baseUrl: '',
      headers: { authorization: 'Bearer test' },
      ip: '1.2.3.4',
    })

    // First two pass
    for (let i = 0; i < 2; i++) {
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() }
      await handler(makeReq(), res, vi.fn())
    }

    // Third gets 429
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() }
    const next = vi.fn()
    await handler(makeReq(), res, next)
    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(429)
  })

  it('sets rate limit headers', async () => {
    @Controller()
    class HeaderCtrl {
      @Get('/h')
      @RateLimit({ max: 10 })
      h() {}
    }

    const adapter = AuthAdapter({
      strategies: [alwaysAuthStrategy],
      defaultPolicy: 'protected',
    })
    adapter.onRouteMount!(HeaderCtrl, '/api')

    const handler = adapter.middleware!()[0].handler
    const req = {
      method: 'GET',
      path: '/api/h',
      baseUrl: '',
      headers: { authorization: 'Bearer test' },
      ip: '1.2.3.4',
    }
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() }
    await handler(req, res, vi.fn())

    expect(res.setHeader).toHaveBeenCalledWith('RateLimit-Limit', 10)
    expect(res.setHeader).toHaveBeenCalledWith('RateLimit-Remaining', 9)
    expect(res.setHeader).toHaveBeenCalledWith('RateLimit-Reset', expect.any(Number))
  })

  it('uses user ID as key when key: "user"', async () => {
    @Controller()
    class UserKeyCtrl {
      @Post('/action')
      @RateLimit({ max: 1, key: 'user' })
      action() {}
    }

    const adapter = AuthAdapter({
      strategies: [alwaysAuthStrategy],
      defaultPolicy: 'protected',
    })
    adapter.onRouteMount!(UserKeyCtrl, '/api')

    const handler = adapter.middleware!()[0].handler

    // User 1 hits limit
    const req1 = {
      method: 'POST',
      path: '/api/action',
      baseUrl: '',
      headers: {},
      ip: '1.1.1.1',
    }
    const res1 = { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() }
    await handler(req1, res1, vi.fn())

    // Same user, different IP, still blocked (keyed by user, not IP)
    const req2 = {
      method: 'POST',
      path: '/api/action',
      baseUrl: '',
      headers: {},
      ip: '2.2.2.2',
    }
    const res2 = { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() }
    const next2 = vi.fn()
    await handler(req2, res2, next2)
    expect(next2).not.toHaveBeenCalled()
    expect(res2.status).toHaveBeenCalledWith(429)
  })

  it('does not rate-limit routes without @RateLimit', async () => {
    @Controller()
    class NoLimitCtrl {
      @Get('/free')
      free() {}
    }

    const adapter = AuthAdapter({
      strategies: [alwaysAuthStrategy],
      defaultPolicy: 'protected',
    })
    adapter.onRouteMount!(NoLimitCtrl, '/api')

    const handler = adapter.middleware!()[0].handler

    for (let i = 0; i < 200; i++) {
      const req = {
        method: 'GET',
        path: '/api/free',
        baseUrl: '',
        headers: {},
        ip: '1.2.3.4',
      }
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() }
      const next = vi.fn()
      await handler(req, res, next)
      expect(next).toHaveBeenCalled()
    }
  })
})
