/**
 * Integration tests for middleware pipeline — covers RequestContext
 * metadata sharing, middleware execution order, and class/method middleware.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import 'reflect-metadata'
import request from 'supertest'
import {
  Container,
  Scope,
  Controller,
  Get,
  Middleware,
  type MiddlewareHandler,
} from '@forinda/kickjs-core'
import { buildRoutes, RequestContext } from '@forinda/kickjs-http'
import { createTestApp, createTestModule } from '@forinda/kickjs-testing'

function reg(cls: any, container: Container) {
  if (!container.has(cls)) container.register(cls, cls, Scope.SINGLETON)
}

// ── ctx.set()/ctx.get() sharing (KICK-009) ────────────────────────────

describe('Middleware: RequestContext metadata sharing (KICK-009)', () => {
  beforeEach(() => Container.reset())

  it('ctx.set() in class middleware is visible to ctx.get() in handler', async () => {
    const setUserMw: MiddlewareHandler = (ctx: RequestContext, next) => {
      ctx.set('user', { id: 'u-1', name: 'Alice' })
      next()
    }

    @Controller()
    @Middleware(setUserMw)
    class ProfileCtrl {
      @Get('/me')
      me(ctx: RequestContext) {
        ctx.json({ user: ctx.get('user') })
      }
    }

    const TestModule = createTestModule({
      register: (c) => reg(ProfileCtrl, c),
      routes: () => ({
        path: '/profile',
        router: buildRoutes(ProfileCtrl),
        controller: ProfileCtrl,
      }),
    })

    const { expressApp } = createTestApp({ modules: [TestModule] })

    const res = await request(expressApp).get('/api/v1/profile/me')
    expect(res.status).toBe(200)
    expect(res.body.user).toEqual({ id: 'u-1', name: 'Alice' })
  })

  it('ctx.set() in method middleware is visible to handler', async () => {
    const injectRole: MiddlewareHandler = (ctx: RequestContext, next) => {
      ctx.set('role', 'admin')
      next()
    }

    @Controller()
    class RoleCtrl {
      @Get('/role')
      @Middleware(injectRole)
      getRole(ctx: RequestContext) {
        ctx.json({ role: ctx.get('role') })
      }
    }

    const TestModule = createTestModule({
      register: (c) => reg(RoleCtrl, c),
      routes: () => ({ path: '/roles', router: buildRoutes(RoleCtrl), controller: RoleCtrl }),
    })

    const { expressApp } = createTestApp({ modules: [TestModule] })

    const res = await request(expressApp).get('/api/v1/roles/role')
    expect(res.status).toBe(200)
    expect(res.body.role).toBe('admin')
  })

  it('metadata is isolated between concurrent requests', async () => {
    const tagMw: MiddlewareHandler = (ctx: RequestContext, next) => {
      ctx.set('tag', ctx.headers['x-tag'])
      next()
    }

    @Controller()
    @Middleware(tagMw)
    class TagCtrl {
      @Get('/echo')
      echo(ctx: RequestContext) {
        ctx.json({ tag: ctx.get('tag') })
      }
    }

    const TestModule = createTestModule({
      register: (c) => reg(TagCtrl, c),
      routes: () => ({ path: '/tags', router: buildRoutes(TagCtrl), controller: TagCtrl }),
    })

    const { expressApp } = createTestApp({ modules: [TestModule] })

    const [res1, res2] = await Promise.all([
      request(expressApp).get('/api/v1/tags/echo').set('x-tag', 'first'),
      request(expressApp).get('/api/v1/tags/echo').set('x-tag', 'second'),
    ])

    expect(res1.body.tag).toBe('first')
    expect(res2.body.tag).toBe('second')
  })
})

// ── Middleware execution order ─────────────────────────────────────────

describe('Middleware: execution order', () => {
  beforeEach(() => Container.reset())

  it('class middleware runs before method middleware, both before handler', async () => {
    const order: string[] = []

    const classMw: MiddlewareHandler = (_ctx, next) => {
      order.push('class')
      next()
    }
    const methodMw: MiddlewareHandler = (_ctx, next) => {
      order.push('method')
      next()
    }

    @Controller()
    @Middleware(classMw)
    class OrderCtrl {
      @Get('/')
      @Middleware(methodMw)
      handle(ctx: RequestContext) {
        order.push('handler')
        ctx.json({ order })
      }
    }

    const TestModule = createTestModule({
      register: (c) => reg(OrderCtrl, c),
      routes: () => ({ path: '/order', router: buildRoutes(OrderCtrl) }),
    })

    const { expressApp } = createTestApp({ modules: [TestModule] })

    const res = await request(expressApp).get('/api/v1/order/')
    expect(res.status).toBe(200)
    expect(res.body.order).toEqual(['class', 'method', 'handler'])
  })

  it('middleware can short-circuit by not calling next()', async () => {
    const blockMw: MiddlewareHandler = (ctx: RequestContext, _next) => {
      ctx.json({ blocked: true }, 403)
    }

    @Controller()
    @Middleware(blockMw)
    class BlockedCtrl {
      @Get('/')
      handle(ctx: RequestContext) {
        ctx.json({ reached: true })
      }
    }

    const TestModule = createTestModule({
      register: (c) => reg(BlockedCtrl, c),
      routes: () => ({ path: '/blocked', router: buildRoutes(BlockedCtrl) }),
    })

    const { expressApp } = createTestApp({ modules: [TestModule] })

    const res = await request(expressApp).get('/api/v1/blocked/')
    expect(res.status).toBe(403)
    expect(res.body.blocked).toBe(true)
  })
})
