/**
 * Integration tests for the adapter lifecycle — covers lifecycle hooks,
 * middleware phases, onRouteMount notifications, shutdown, and
 * multiple adapters running together.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'reflect-metadata'
import request from 'supertest'
import {
  Container,
  Scope,
  Controller,
  Get,
  type AppAdapter,
  type AdapterMiddleware,
} from '@forinda/kickjs-core'
import { Application, buildRoutes, RequestContext } from '@forinda/kickjs-http'
import { createTestApp, createTestModule } from '@forinda/kickjs-testing'

function reg(cls: any, container: Container) {
  if (!container.has(cls)) container.register(cls, cls, Scope.SINGLETON)
}

function createSimpleModule() {
  @Controller()
  class SimpleCtrl {
    @Get('/')
    index(ctx: RequestContext) {
      ctx.json({ ok: true })
    }
  }

  return {
    Ctrl: SimpleCtrl,
    Module: createTestModule({
      register: (c) => reg(SimpleCtrl, c),
      routes: () => ({ path: '/test', router: buildRoutes(SimpleCtrl), controller: SimpleCtrl }),
    }),
  }
}

// ── Lifecycle hooks ───────────────────────────────────────────────────

describe('Adapters: lifecycle hooks', () => {
  beforeEach(() => Container.reset())

  it('beforeMount runs before beforeStart', async () => {
    const order: string[] = []

    const adapter: AppAdapter = {
      name: 'LifecycleAdapter',
      beforeMount: () => order.push('beforeMount'),
      beforeStart: () => order.push('beforeStart'),
    }

    const { Module } = createSimpleModule()
    await createTestApp({ modules: [Module], adapters: [adapter] })

    expect(order).toEqual(['beforeMount', 'beforeStart'])
  })

  it('beforeMount receives the express app and container', async () => {
    let receivedApp: any = null
    let receivedContainer: any = null

    const adapter: AppAdapter = {
      name: 'InspectAdapter',
      beforeMount: (app, container) => {
        receivedApp = app
        receivedContainer = container
      },
    }

    const { Module } = createSimpleModule()
    await createTestApp({ modules: [Module], adapters: [adapter] })

    expect(receivedApp).toBeDefined()
    expect(receivedContainer).toBeInstanceOf(Container)
  })

  it('shutdown is called and can be awaited', async () => {
    const shutdownOrder: string[] = []

    const adapterA: AppAdapter = {
      name: 'A',
      shutdown: async () => {
        shutdownOrder.push('A')
      },
    }
    const adapterB: AppAdapter = {
      name: 'B',
      shutdown: async () => {
        shutdownOrder.push('B')
      },
    }

    const { Module } = createSimpleModule()
    const { app } = await createTestApp({ modules: [Module], adapters: [adapterA, adapterB] })

    await app.shutdown()

    expect(shutdownOrder).toContain('A')
    expect(shutdownOrder).toContain('B')
  })

  it('shutdown does not throw when one adapter fails', async () => {
    const adapterOk: AppAdapter = {
      name: 'Ok',
      shutdown: async () => {},
    }
    const adapterBad: AppAdapter = {
      name: 'Bad',
      shutdown: async () => {
        throw new Error('shutdown failed')
      },
    }

    const { Module } = createSimpleModule()
    const { app } = await createTestApp({ modules: [Module], adapters: [adapterOk, adapterBad] })

    await expect(app.shutdown()).resolves.toBeUndefined()
  })
})

// ── onRouteMount ──────────────────────────────────────────────────────

describe('Adapters: onRouteMount', () => {
  beforeEach(() => Container.reset())

  it('onRouteMount is called for each module with a controller', async () => {
    const mounted: Array<{ ctrl: string; path: string }> = []

    const spyAdapter: AppAdapter = {
      name: 'SpyAdapter',
      onRouteMount: (ctrl, path) => {
        mounted.push({ ctrl: ctrl.name, path })
      },
    }

    @Controller()
    class UsersCtrl {
      @Get('/')
      list(ctx: RequestContext) {
        ctx.json([])
      }
    }

    @Controller()
    class PostsCtrl {
      @Get('/')
      list(ctx: RequestContext) {
        ctx.json([])
      }
    }

    const UsersModule = createTestModule({
      register: (c) => reg(UsersCtrl, c),
      routes: () => ({ path: '/users', router: buildRoutes(UsersCtrl), controller: UsersCtrl }),
    })

    const PostsModule = createTestModule({
      register: (c) => reg(PostsCtrl, c),
      routes: () => ({ path: '/posts', router: buildRoutes(PostsCtrl), controller: PostsCtrl }),
    })

    await createTestApp({ modules: [UsersModule, PostsModule], adapters: [spyAdapter] })

    expect(mounted).toHaveLength(2)
    expect(mounted[0]).toEqual({ ctrl: 'UsersCtrl', path: '/api/v1/users' })
    expect(mounted[1]).toEqual({ ctrl: 'PostsCtrl', path: '/api/v1/posts' })
  })

  it('onRouteMount is not called for modules without controller', async () => {
    const mounted: string[] = []

    const spyAdapter: AppAdapter = {
      name: 'SpyAdapter',
      onRouteMount: (_, path) => mounted.push(path),
    }

    @Controller()
    class Ctrl {
      @Get('/')
      index(ctx: RequestContext) {
        ctx.json({})
      }
    }

    const WithCtrl = createTestModule({
      register: (c) => reg(Ctrl, c),
      routes: () => ({ path: '/with', router: buildRoutes(Ctrl), controller: Ctrl }),
    })

    const WithoutCtrl = createTestModule({
      register: (c) => reg(Ctrl, c),
      routes: () => ({ path: '/without', router: buildRoutes(Ctrl) }), // no controller
    })

    await createTestApp({ modules: [WithCtrl, WithoutCtrl], adapters: [spyAdapter] })

    expect(mounted).toEqual(['/api/v1/with'])
  })
})

// ── Middleware phases ─────────────────────────────────────────────────

describe('Adapters: middleware phases', () => {
  beforeEach(() => Container.reset())

  it('beforeRoutes middleware runs before route handler', async () => {
    const order: string[] = []

    const adapter: AppAdapter = {
      name: 'PhaseAdapter',
      middleware: () => [
        {
          handler: (_req: any, _res: any, next: any) => {
            order.push('beforeRoutes')
            next()
          },
          phase: 'beforeRoutes' as const,
        },
      ],
    }

    @Controller()
    class OrderCtrl {
      @Get('/')
      index(ctx: RequestContext) {
        order.push('handler')
        ctx.json({ order })
      }
    }

    const TestModule = createTestModule({
      register: (c) => reg(OrderCtrl, c),
      routes: () => ({ path: '/order', router: buildRoutes(OrderCtrl) }),
    })

    const { expressApp } = await createTestApp({ modules: [TestModule], adapters: [adapter] })

    const res = await request(expressApp).get('/api/v1/order/')
    expect(res.status).toBe(200)
    expect(res.body.order).toEqual(['beforeRoutes', 'handler'])
  })

  it('adapter middleware can inject headers into requests', async () => {
    const adapter: AppAdapter = {
      name: 'HeaderAdapter',
      middleware: () => [
        {
          handler: (req: any, _res: any, next: any) => {
            req.headers['x-injected'] = 'by-adapter'
            next()
          },
          phase: 'beforeRoutes' as const,
        },
      ],
    }

    @Controller()
    class HeaderCtrl {
      @Get('/')
      index(ctx: RequestContext) {
        ctx.json({ injected: ctx.headers['x-injected'] })
      }
    }

    const TestModule = createTestModule({
      register: (c) => reg(HeaderCtrl, c),
      routes: () => ({ path: '/headers', router: buildRoutes(HeaderCtrl) }),
    })

    const { expressApp } = await createTestApp({ modules: [TestModule], adapters: [adapter] })

    const res = await request(expressApp).get('/api/v1/headers/')
    expect(res.status).toBe(200)
    expect(res.body.injected).toBe('by-adapter')
  })
})

// ── Multiple adapters ─────────────────────────────────────────────────

describe('Adapters: multiple adapters', () => {
  beforeEach(() => Container.reset())

  it('multiple adapters all receive lifecycle hooks in order', async () => {
    const events: string[] = []

    const adapterA: AppAdapter = {
      name: 'A',
      beforeMount: () => events.push('A:beforeMount'),
      beforeStart: () => events.push('A:beforeStart'),
    }

    const adapterB: AppAdapter = {
      name: 'B',
      beforeMount: () => events.push('B:beforeMount'),
      beforeStart: () => events.push('B:beforeStart'),
    }

    const { Module } = createSimpleModule()
    await createTestApp({ modules: [Module], adapters: [adapterA, adapterB] })

    // All beforeMount before any beforeStart
    expect(events.indexOf('A:beforeMount')).toBeLessThan(events.indexOf('A:beforeStart'))
    expect(events.indexOf('B:beforeMount')).toBeLessThan(events.indexOf('B:beforeStart'))
    // Registration order preserved
    expect(events.indexOf('A:beforeMount')).toBeLessThan(events.indexOf('B:beforeMount'))
  })

  it('multiple adapters can each contribute middleware', async () => {
    const tags: string[] = []

    const adapterA: AppAdapter = {
      name: 'A',
      middleware: () => [
        {
          handler: (_req: any, _res: any, next: any) => {
            tags.push('A')
            next()
          },
          phase: 'beforeRoutes' as const,
        },
      ],
    }

    const adapterB: AppAdapter = {
      name: 'B',
      middleware: () => [
        {
          handler: (_req: any, _res: any, next: any) => {
            tags.push('B')
            next()
          },
          phase: 'beforeRoutes' as const,
        },
      ],
    }

    @Controller()
    class MultiCtrl {
      @Get('/')
      index(ctx: RequestContext) {
        ctx.json({ tags })
      }
    }

    const TestModule = createTestModule({
      register: (c) => reg(MultiCtrl, c),
      routes: () => ({ path: '/multi', router: buildRoutes(MultiCtrl) }),
    })

    const { expressApp } = await createTestApp({
      modules: [TestModule],
      adapters: [adapterA, adapterB],
    })

    const res = await request(expressApp).get('/api/v1/multi/')
    expect(res.status).toBe(200)
    expect(res.body.tags).toEqual(['A', 'B'])
  })
})
