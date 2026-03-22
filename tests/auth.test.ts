/**
 * Integration tests for authentication — covers AuthAdapter,
 * @Public/@Authenticated decorators, API key strategy, and
 * role-based access via the full HTTP pipeline.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import 'reflect-metadata'
import request from 'supertest'
import { Container, Scope, Controller, Get } from '@forinda/kickjs-core'
import { buildRoutes, RequestContext } from '@forinda/kickjs-http'
import { AuthAdapter, ApiKeyStrategy, Public, Authenticated } from '@forinda/kickjs-auth'
import { createTestApp, createTestModule } from '@forinda/kickjs-testing'

function reg(cls: any, container: Container) {
  if (!container.has(cls)) container.register(cls, cls, Scope.SINGLETON)
}

// ── @Public() bypass (KICK-010) ───────────────────────────────────────

describe('Auth: @Public() routes bypass auth (KICK-010)', () => {
  beforeEach(() => Container.reset())

  it('@Public() passes without auth, undecorated returns 401', async () => {
    @Controller()
    class AppCtrl {
      @Get('/health')
      @Public()
      health(ctx: RequestContext) {
        ctx.json({ ok: true })
      }

      @Get('/secret')
      secret(ctx: RequestContext) {
        ctx.json({ data: 'classified' })
      }
    }

    const TestModule = createTestModule({
      register: (c) => reg(AppCtrl, c),
      routes: () => ({ path: '/app', router: buildRoutes(AppCtrl), controller: AppCtrl }),
    })

    const authAdapter = new AuthAdapter({
      strategies: [new ApiKeyStrategy({ keys: { 'sk-valid': { name: 'Bot' } } })],
      defaultPolicy: 'protected',
    })

    const { expressApp } = createTestApp({
      modules: [TestModule],
      adapters: [authAdapter],
    })

    // Public route — no auth
    const publicRes = await request(expressApp).get('/api/v1/app/health')
    expect(publicRes.status).toBe(200)
    expect(publicRes.body.ok).toBe(true)

    // Protected route — no key → 401
    const protectedRes = await request(expressApp).get('/api/v1/app/secret')
    expect(protectedRes.status).toBe(401)
  })
})

// ── API key authentication ────────────────────────────────────────────

describe('Auth: API key strategy', () => {
  beforeEach(() => Container.reset())

  it('valid API key passes and attaches user to req', async () => {
    @Controller()
    class SecureCtrl {
      @Get('/whoami')
      whoami(ctx: RequestContext) {
        ctx.json({ user: (ctx.req as any).user })
      }
    }

    const TestModule = createTestModule({
      register: (c) => reg(SecureCtrl, c),
      routes: () => ({ path: '/secure', router: buildRoutes(SecureCtrl), controller: SecureCtrl }),
    })

    const authAdapter = new AuthAdapter({
      strategies: [
        new ApiKeyStrategy({
          keys: { 'sk-abc': { name: 'Alice', roles: ['admin'] } },
        }),
      ],
      defaultPolicy: 'protected',
    })

    const { expressApp } = createTestApp({
      modules: [TestModule],
      adapters: [authAdapter],
    })

    const res = await request(expressApp)
      .get('/api/v1/secure/whoami')
      .set('x-api-key', 'sk-abc')

    expect(res.status).toBe(200)
    expect(res.body.user.name).toBe('Alice')
    expect(res.body.user.roles).toContain('admin')
  })

  it('invalid API key returns 401', async () => {
    @Controller()
    class SecureCtrl2 {
      @Get('/')
      index(ctx: RequestContext) {
        ctx.json({ ok: true })
      }
    }

    const TestModule = createTestModule({
      register: (c) => reg(SecureCtrl2, c),
      routes: () => ({
        path: '/secure2',
        router: buildRoutes(SecureCtrl2),
        controller: SecureCtrl2,
      }),
    })

    const authAdapter = new AuthAdapter({
      strategies: [new ApiKeyStrategy({ keys: { 'sk-real': { name: 'Bot' } } })],
      defaultPolicy: 'protected',
    })

    const { expressApp } = createTestApp({
      modules: [TestModule],
      adapters: [authAdapter],
    })

    const res = await request(expressApp)
      .get('/api/v1/secure2/')
      .set('x-api-key', 'sk-wrong')

    expect(res.status).toBe(401)
  })
})

// ── Open default policy ───────────────────────────────────────────────

describe('Auth: open default policy', () => {
  beforeEach(() => Container.reset())

  it('all routes pass without auth when defaultPolicy is open', async () => {
    @Controller()
    class OpenCtrl {
      @Get('/')
      index(ctx: RequestContext) {
        ctx.json({ open: true })
      }
    }

    const TestModule = createTestModule({
      register: (c) => reg(OpenCtrl, c),
      routes: () => ({ path: '/open', router: buildRoutes(OpenCtrl), controller: OpenCtrl }),
    })

    const authAdapter = new AuthAdapter({
      strategies: [],
      defaultPolicy: 'open',
    })

    const { expressApp } = createTestApp({
      modules: [TestModule],
      adapters: [authAdapter],
    })

    const res = await request(expressApp).get('/api/v1/open/')
    expect(res.status).toBe(200)
    expect(res.body.open).toBe(true)
  })
})
