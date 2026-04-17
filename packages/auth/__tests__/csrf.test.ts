import { describe, it, expect, vi } from 'vitest'
import 'reflect-metadata'
import { AuthAdapter, CsrfExempt, Public, type AuthStrategy } from '@forinda/kickjs-auth'
import { Controller, Get, Post, Delete } from '@forinda/kickjs'

// Stub strategy that reads from cookies (triggers CSRF auto-detect)
const cookieJwtStrategy: AuthStrategy = {
  name: 'jwt',
  validate: async (req) => {
    if (req.cookies?.jwt) return { id: '1', name: 'User' }
    return null
  },
}
// Expose tokenFrom so adapter can detect cookie-based auth
;(cookieJwtStrategy as any).options = { tokenFrom: 'cookie' }

// Header-only strategy (should NOT trigger CSRF)
const headerStrategy: AuthStrategy = {
  name: 'jwt',
  validate: async (req) => {
    if (req.headers?.authorization) return { id: '1', name: 'User' }
    return null
  },
}

describe('CSRF Integration', () => {
  describe('auto-detection', () => {
    it('enables CSRF when strategy uses cookies', () => {
      const adapter = new AuthAdapter({
        strategies: [cookieJwtStrategy],
      })

      const middlewares = adapter.middleware!()
      // Should have auth middleware + CSRF middleware
      expect(middlewares).toHaveLength(2)
    })

    it('does not enable CSRF for header-only auth', () => {
      const adapter = new AuthAdapter({
        strategies: [headerStrategy],
      })

      const middlewares = adapter.middleware!()
      expect(middlewares).toHaveLength(1)
    })

    it('enables CSRF for session strategy', () => {
      const sessionStrategy: AuthStrategy = {
        name: 'session',
        validate: async () => null,
      }

      const adapter = new AuthAdapter({
        strategies: [sessionStrategy],
      })

      const middlewares = adapter.middleware!()
      expect(middlewares).toHaveLength(2)
    })
  })

  describe('explicit csrf option', () => {
    it('csrf: true forces CSRF on', () => {
      const adapter = new AuthAdapter({
        strategies: [headerStrategy],
        csrf: true,
      })

      expect(adapter.middleware!()).toHaveLength(2)
    })

    it('csrf: false forces CSRF off even with cookie strategy', () => {
      const adapter = new AuthAdapter({
        strategies: [cookieJwtStrategy],
        csrf: false,
      })

      expect(adapter.middleware!()).toHaveLength(1)
    })

    it('csrf: object enables with custom config', () => {
      const adapter = new AuthAdapter({
        strategies: [headerStrategy],
        csrf: { cookie: '_xsrf', header: 'x-xsrf-token' },
      })

      expect(adapter.middleware!()).toHaveLength(2)
    })
  })

  describe('CSRF middleware behavior', () => {
    function createCsrfAdapter() {
      return new AuthAdapter({
        strategies: [{ name: 'test', validate: async () => ({ id: '1' }) }],
        defaultPolicy: 'open',
        csrf: true,
      })
    }

    it('sets CSRF cookie on GET request and passes through', async () => {
      const adapter = createCsrfAdapter()
      const csrfMiddleware = adapter.middleware!()[1].handler

      const cookies: Record<string, any> = {}
      const req = { method: 'GET', cookies: {}, headers: {}, path: '/test', baseUrl: '' }
      const res = {
        cookie: vi.fn((name: string, value: any) => {
          cookies[name] = value
        }),
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      }
      const next = vi.fn()

      await csrfMiddleware(req, res, next)
      expect(next).toHaveBeenCalled()
      expect(res.cookie).toHaveBeenCalledWith('_csrf', expect.any(String), expect.any(Object))
    })

    it('blocks POST without CSRF token', async () => {
      const adapter = createCsrfAdapter()
      const csrfMiddleware = adapter.middleware!()[1].handler

      const req = {
        method: 'POST',
        cookies: { _csrf: 'valid-token' },
        headers: {},
        path: '/test',
        baseUrl: '',
      }
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), cookie: vi.fn() }
      const next = vi.fn()

      await csrfMiddleware(req, res, next)
      expect(next).not.toHaveBeenCalled()
      expect(res.status).toHaveBeenCalledWith(403)
    })

    it('allows POST with matching CSRF token', async () => {
      const adapter = createCsrfAdapter()
      const csrfMiddleware = adapter.middleware!()[1].handler

      const token = 'a-valid-csrf-token'
      const req = {
        method: 'POST',
        cookies: { _csrf: token },
        headers: { 'x-csrf-token': token },
        path: '/test',
        baseUrl: '',
      }
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), cookie: vi.fn() }
      const next = vi.fn()

      await csrfMiddleware(req, res, next)
      expect(next).toHaveBeenCalled()
    })

    it('blocks DELETE without CSRF token', async () => {
      const adapter = createCsrfAdapter()
      const csrfMiddleware = adapter.middleware!()[1].handler

      const req = {
        method: 'DELETE',
        cookies: { _csrf: 'token' },
        headers: {},
        path: '/test',
        baseUrl: '',
      }
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), cookie: vi.fn() }
      const next = vi.fn()

      await csrfMiddleware(req, res, next)
      expect(next).not.toHaveBeenCalled()
      expect(res.status).toHaveBeenCalledWith(403)
    })
  })

  describe('@Public auto-exempts CSRF', () => {
    it('skips CSRF validation for @Public() POST routes', async () => {
      @Controller()
      class AuthCtrl {
        @Post('/login')
        @Public()
        login() {}

        @Post('/update-profile')
        updateProfile() {}
      }

      const adapter = new AuthAdapter({
        strategies: [{ name: 'test', validate: async () => ({ id: '1' }) }],
        defaultPolicy: 'protected',
        csrf: true,
      })

      adapter.onRouteMount!(AuthCtrl, '/auth')

      const csrfMiddleware = adapter.middleware!()[1].handler

      // @Public() login route: POST without CSRF token should pass
      const loginReq = {
        method: 'POST',
        path: '/auth/login',
        cookies: { _csrf: 'token' },
        headers: {},
        baseUrl: '',
      }
      const loginRes = { status: vi.fn().mockReturnThis(), json: vi.fn(), cookie: vi.fn() }
      const loginNext = vi.fn()

      await csrfMiddleware(loginReq, loginRes, loginNext)
      expect(loginNext).toHaveBeenCalled()

      // Protected route: POST without CSRF token should be blocked
      const profileReq = {
        method: 'POST',
        path: '/auth/update-profile',
        cookies: { _csrf: 'token' },
        headers: {},
        baseUrl: '',
      }
      const profileRes = { status: vi.fn().mockReturnThis(), json: vi.fn(), cookie: vi.fn() }
      const profileNext = vi.fn()

      await csrfMiddleware(profileReq, profileRes, profileNext)
      expect(profileNext).not.toHaveBeenCalled()
      expect(profileRes.status).toHaveBeenCalledWith(403)
    })
  })

  describe('BFF / gateway pattern (mixed strategies)', () => {
    const sessionStrategy: AuthStrategy = {
      name: 'session',
      validate: async (req) => (req.cookies?.sid ? { id: '1' } : null),
    }
    const bearerJwt: AuthStrategy = {
      name: 'jwt',
      validate: async (req) =>
        req.headers?.authorization?.startsWith('Bearer ') ? { id: '1' } : null,
    }

    it('auto-enables CSRF when session is mixed with header-only JWT', () => {
      const adapter = new AuthAdapter({ strategies: [sessionStrategy, bearerJwt] })
      expect(adapter.middleware!()).toHaveLength(2)
    })

    it('fires CSRF on Bearer-only server-to-server requests (documents the gotcha)', async () => {
      const adapter = new AuthAdapter({
        strategies: [sessionStrategy, bearerJwt],
        defaultPolicy: 'open',
      })
      const csrfMiddleware = adapter.middleware!()[1].handler

      const req = {
        method: 'POST',
        path: '/tasks',
        baseUrl: '',
        cookies: { _csrf: 'token' },
        headers: { authorization: 'Bearer jwt.token.here' },
      }
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), cookie: vi.fn() }
      const next = vi.fn()

      await csrfMiddleware(req, res, next)
      expect(next).not.toHaveBeenCalled()
      expect(res.status).toHaveBeenCalledWith(403)
    })

    it('fix 1: csrf:false on JWT-only API tier lets Bearer requests through', () => {
      const adapter = new AuthAdapter({ strategies: [bearerJwt], csrf: false })
      expect(adapter.middleware!()).toHaveLength(1)
    })

    it('fix 2: @CsrfExempt on JWT-strategy route bypasses CSRF while session routes stay protected', async () => {
      @Controller()
      class MixedCtrl {
        @Post('/s2s/sync')
        @CsrfExempt()
        serverSync() {}

        @Post('/me')
        updateMe() {}
      }

      const adapter = new AuthAdapter({
        strategies: [sessionStrategy, bearerJwt],
        defaultPolicy: 'open',
      })
      adapter.onRouteMount!(MixedCtrl, '/api')
      const csrfMiddleware = adapter.middleware!()[1].handler

      const s2sReq = {
        method: 'POST',
        path: '/api/s2s/sync',
        baseUrl: '',
        cookies: { _csrf: 'token' },
        headers: { authorization: 'Bearer jwt' },
      }
      const s2sRes = { status: vi.fn().mockReturnThis(), json: vi.fn(), cookie: vi.fn() }
      const s2sNext = vi.fn()
      await csrfMiddleware(s2sReq, s2sRes, s2sNext)
      expect(s2sNext).toHaveBeenCalled()

      const meReq = {
        method: 'POST',
        path: '/api/me',
        baseUrl: '',
        cookies: { sid: 'abc', _csrf: 'token' },
        headers: {},
      }
      const meRes = { status: vi.fn().mockReturnThis(), json: vi.fn(), cookie: vi.fn() }
      const meNext = vi.fn()
      await csrfMiddleware(meReq, meRes, meNext)
      expect(meNext).not.toHaveBeenCalled()
      expect(meRes.status).toHaveBeenCalledWith(403)
    })

    it('fix 3: keeping CSRF on and echoing the cookie header still works for cookie clients', async () => {
      const adapter = new AuthAdapter({
        strategies: [sessionStrategy, bearerJwt],
        defaultPolicy: 'open',
      })
      const csrfMiddleware = adapter.middleware!()[1].handler

      const token = 'matching-token'
      const req = {
        method: 'POST',
        path: '/me',
        baseUrl: '',
        cookies: { sid: 'abc', _csrf: token },
        headers: { 'x-csrf-token': token },
      }
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), cookie: vi.fn() }
      const next = vi.fn()
      await csrfMiddleware(req, res, next)
      expect(next).toHaveBeenCalled()
    })
  })

  describe('@CsrfExempt decorator', () => {
    it('exempts decorated route from CSRF', async () => {
      @Controller()
      class WebhookCtrl {
        @Post('/webhook')
        @CsrfExempt()
        handleWebhook() {}

        @Post('/protected')
        doSomething() {}
      }

      const adapter = new AuthAdapter({
        strategies: [{ name: 'test', validate: async () => ({ id: '1' }) }],
        defaultPolicy: 'open',
        csrf: true,
      })

      adapter.onRouteMount!(WebhookCtrl, '/api')

      const csrfMiddleware = adapter.middleware!()[1].handler

      // Exempt route: POST /api/webhook should pass without CSRF token
      const exemptReq = {
        method: 'POST',
        path: '/api/webhook',
        cookies: { _csrf: 'token' },
        headers: {},
        baseUrl: '',
      }
      const exemptRes = { status: vi.fn().mockReturnThis(), json: vi.fn(), cookie: vi.fn() }
      const exemptNext = vi.fn()

      await csrfMiddleware(exemptReq, exemptRes, exemptNext)
      expect(exemptNext).toHaveBeenCalled()

      // Non-exempt route: POST /api/protected should be blocked
      const protectedReq = {
        method: 'POST',
        path: '/api/protected',
        cookies: { _csrf: 'token' },
        headers: {},
        baseUrl: '',
      }
      const protectedRes = { status: vi.fn().mockReturnThis(), json: vi.fn(), cookie: vi.fn() }
      const protectedNext = vi.fn()

      await csrfMiddleware(protectedReq, protectedRes, protectedNext)
      expect(protectedNext).not.toHaveBeenCalled()
      expect(protectedRes.status).toHaveBeenCalledWith(403)
    })
  })
})
