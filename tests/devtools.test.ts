/**
 * Integration tests for DevToolsAdapter — covers debug endpoints,
 * peer adapter discovery (queue stats, ws stats), metrics tracking,
 * and the interaction between DevTools and other adapters.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import 'reflect-metadata'
import request from 'supertest'
import {
  Container,
  Scope,
  Controller,
  Get,
  Post,
  type AppAdapter,
} from '@forinda/kickjs-core'
import { buildRoutes, RequestContext } from '@forinda/kickjs-http'
import { DevToolsAdapter } from '@forinda/kickjs-devtools'
import { createTestApp, createTestModule } from '@forinda/kickjs-testing'

function reg(cls: any, container: Container) {
  if (!container.has(cls)) container.register(cls, cls, Scope.SINGLETON)
}

// ── DevTools debug endpoints ──────────────────────────────────────────

describe('DevTools: debug endpoints', () => {
  beforeEach(() => Container.reset())

  async function createAppWithDevtools(opts?: { adapters?: AppAdapter[] }) {
    @Controller()
    class AppCtrl {
      @Get('/')
      index(ctx: RequestContext) {
        ctx.json({ ok: true })
      }

      @Post('/action')
      action(ctx: RequestContext) {
        ctx.created({ done: true })
      }
    }

    const TestModule = createTestModule({
      register: (c) => reg(AppCtrl, c),
      routes: () => ({ path: '/app', router: buildRoutes(AppCtrl), controller: AppCtrl }),
    })

    const devtools = new DevToolsAdapter({
      secret: false, // disable auth for tests
      adapters: opts?.adapters ?? [],
    })

    return await createTestApp({
      modules: [TestModule],
      adapters: [devtools, ...(opts?.adapters ?? [])],
    })
  }

  it('/_debug/health returns health status', async () => {
    const { expressApp } = await createAppWithDevtools()

    const res = await request(expressApp).get('/_debug/health')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('status')
    expect(res.body).toHaveProperty('uptime')
  })

  it('/_debug/metrics returns request metrics', async () => {
    const { expressApp } = await createAppWithDevtools()

    // Make some requests to generate metrics
    await request(expressApp).get('/api/v1/app/')
    await request(expressApp).get('/api/v1/app/')

    const res = await request(expressApp).get('/_debug/metrics')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('requests')
    expect(res.body.requests).toBeGreaterThanOrEqual(2)
  })

  it('/_debug/routes returns registered routes', async () => {
    const { expressApp } = await createAppWithDevtools()

    const res = await request(expressApp).get('/_debug/routes')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('routes')
    expect(Array.isArray(res.body.routes)).toBe(true)
  })
})

// ── DevTools + QueueAdapter peer discovery (KICK-012) ─────────────────

describe('DevTools: queue adapter peer discovery', () => {
  beforeEach(() => Container.reset())

  it('/_debug/queues returns stats when QueueAdapter peer is provided', async () => {
    // Mock QueueAdapter — matches the duck-typing check in DevToolsAdapter
    const mockQueueAdapter: AppAdapter = {
      name: 'QueueAdapter',
      getQueueNames: () => ['email', 'notifications'],
      getQueueStats: async (name: string) => ({
        waiting: name === 'email' ? 5 : 0,
        active: 1,
        completed: 100,
        failed: 2,
        delayed: 0,
        paused: 0,
      }),
    } as any

    @Controller()
    class QCtrl {
      @Get('/')
      index(ctx: RequestContext) {
        ctx.json({})
      }
    }

    const TestModule = createTestModule({
      register: (c) => reg(QCtrl, c),
      routes: () => ({ path: '/q', router: buildRoutes(QCtrl), controller: QCtrl }),
    })

    const devtools = new DevToolsAdapter({
      secret: false,
      adapters: [mockQueueAdapter],
    })

    const { expressApp } = await createTestApp({
      modules: [TestModule],
      adapters: [devtools, mockQueueAdapter],
    })

    const res = await request(expressApp).get('/_debug/queues')
    expect(res.status).toBe(200)
    expect(res.body.enabled).toBe(true)
    expect(res.body.queues).toHaveLength(2)
    expect(res.body.queues[0].name).toBe('email')
    expect(res.body.queues[0].waiting).toBe(5)
    expect(res.body.queues[1].name).toBe('notifications')
    expect(res.body.queues[1].waiting).toBe(0)
  })

  it('/_debug/queues returns disabled when no QueueAdapter peer', async () => {
    @Controller()
    class NoQCtrl {
      @Get('/')
      index(ctx: RequestContext) {
        ctx.json({})
      }
    }

    const TestModule = createTestModule({
      register: (c) => reg(NoQCtrl, c),
      routes: () => ({ path: '/noq', router: buildRoutes(NoQCtrl), controller: NoQCtrl }),
    })

    const devtools = new DevToolsAdapter({
      secret: false,
      adapters: [], // no queue adapter
    })

    const { expressApp } = await createTestApp({
      modules: [TestModule],
      adapters: [devtools],
    })

    const res = await request(expressApp).get('/_debug/queues')
    expect(res.status).toBe(200)
    expect(res.body.enabled).toBe(false)
    expect(res.body.message).toContain('not found')
  })

  it('/_debug/queues handles stats fetch failure gracefully', async () => {
    const brokenQueueAdapter: AppAdapter = {
      name: 'QueueAdapter',
      getQueueNames: () => ['broken-queue'],
      getQueueStats: async () => {
        throw new Error('Redis connection lost')
      },
    } as any

    @Controller()
    class BrokenCtrl {
      @Get('/')
      index(ctx: RequestContext) {
        ctx.json({})
      }
    }

    const TestModule = createTestModule({
      register: (c) => reg(BrokenCtrl, c),
      routes: () => ({ path: '/broken', router: buildRoutes(BrokenCtrl), controller: BrokenCtrl }),
    })

    const devtools = new DevToolsAdapter({
      secret: false,
      adapters: [brokenQueueAdapter],
    })

    const { expressApp } = await createTestApp({
      modules: [TestModule],
      adapters: [devtools, brokenQueueAdapter],
    })

    const res = await request(expressApp).get('/_debug/queues')
    expect(res.status).toBe(200)
    // Should not crash — returns error gracefully
    expect(res.body.enabled).toBe(true)
    expect(res.body).toHaveProperty('error')
  })
})

// ── DevTools + WsAdapter peer discovery ───────────────────────────────

describe('DevTools: ws adapter peer discovery', () => {
  beforeEach(() => Container.reset())

  it('/_debug/ws returns stats when WsAdapter peer is provided', async () => {
    const mockWsAdapter: AppAdapter = {
      name: 'WsAdapter',
      getStats: () => ({
        activeConnections: 12,
        messagesReceived: 340,
        messagesSent: 280,
      }),
    } as any

    @Controller()
    class WsCtrl {
      @Get('/')
      index(ctx: RequestContext) {
        ctx.json({})
      }
    }

    const TestModule = createTestModule({
      register: (c) => reg(WsCtrl, c),
      routes: () => ({ path: '/ws', router: buildRoutes(WsCtrl), controller: WsCtrl }),
    })

    const devtools = new DevToolsAdapter({
      secret: false,
      adapters: [mockWsAdapter],
    })

    const { expressApp } = await createTestApp({
      modules: [TestModule],
      adapters: [devtools, mockWsAdapter],
    })

    const res = await request(expressApp).get('/_debug/ws')
    expect(res.status).toBe(200)
    expect(res.body.enabled).toBe(true)
    expect(res.body.activeConnections).toBe(12)
  })

  it('/_debug/ws returns disabled when no WsAdapter peer', async () => {
    @Controller()
    class NoWsCtrl {
      @Get('/')
      index(ctx: RequestContext) {
        ctx.json({})
      }
    }

    const TestModule = createTestModule({
      register: (c) => reg(NoWsCtrl, c),
      routes: () => ({ path: '/nows', router: buildRoutes(NoWsCtrl), controller: NoWsCtrl }),
    })

    const devtools = new DevToolsAdapter({
      secret: false,
      adapters: [],
    })

    const { expressApp } = await createTestApp({
      modules: [TestModule],
      adapters: [devtools],
    })

    const res = await request(expressApp).get('/_debug/ws')
    expect(res.status).toBe(200)
    expect(res.body.enabled).toBe(false)
  })
})
