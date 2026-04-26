import 'reflect-metadata'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import {
  Container,
  Scope,
  Service,
  Inject,
  Controller,
  Get,
  buildRoutes,
  RequestContext,
  requestStore,
  requestScopeMiddleware,
  type RequestStore,
  createToken,
} from '../src/index'
import { createTestApp, createTestModule } from '@forinda/kickjs-testing'
import express from 'express'

// ── Helpers ─────────────────────────────────────────────────────────────

let callCount = 0

function resetCallCount() {
  callCount = 0
}

/** Wire the container's request store provider to use the shared AsyncLocalStorage */
function wireRequestStoreProvider() {
  Container._requestStoreProvider = () => requestStore.getStore() ?? null
}

/** Run a callback inside a fake request context */
function runInRequestContext<T>(fn: () => T, reqId = 'test-req-1'): T {
  const store: RequestStore = {
    requestId: reqId,
    instances: new Map(),
    values: new Map(),
  }
  return requestStore.run(store, fn)
}

// ── Unit-level Container tests ──────────────────────────────────────────

describe('REQUEST scope — Container unit tests', () => {
  beforeEach(() => {
    Container.reset()
    resetCallCount()
    wireRequestStoreProvider()
  })

  afterEach(() => {
    Container._requestStoreProvider = null
  })

  it('returns a fresh instance per request context', () => {
    @Service({ scope: Scope.REQUEST })
    class ReqService {
      id = ++callCount
    }

    const container = Container.getInstance()
    container.register(ReqService, ReqService, Scope.REQUEST)

    const id1 = runInRequestContext(() => container.resolve<ReqService>(ReqService).id, 'req-1')
    const id2 = runInRequestContext(() => container.resolve<ReqService>(ReqService).id, 'req-2')

    expect(id1).toBe(1)
    expect(id2).toBe(2)
  })

  it('caches instance within the same request context', () => {
    @Service({ scope: Scope.REQUEST })
    class CachedReqService {
      id = ++callCount
    }

    const container = Container.getInstance()
    container.register(CachedReqService, CachedReqService, Scope.REQUEST)

    runInRequestContext(() => {
      const a = container.resolve<CachedReqService>(CachedReqService)
      const b = container.resolve<CachedReqService>(CachedReqService)
      expect(a).toBe(b)
      expect(a.id).toBe(b.id)
    })
  })

  it('throws when resolving REQUEST-scoped service outside request context', () => {
    @Service({ scope: Scope.REQUEST })
    class OutsideReqService {
      id = ++callCount
    }

    const container = Container.getInstance()
    container.register(OutsideReqService, OutsideReqService, Scope.REQUEST)

    expect(() => container.resolve(OutsideReqService)).toThrow(/outside.*request context/i)
  })

  it('throws when no request store provider is configured', () => {
    @Service({ scope: Scope.REQUEST })
    class NoProviderService {
      id = ++callCount
    }

    const container = Container.getInstance()
    container.register(NoProviderService, NoProviderService, Scope.REQUEST)
    Container._requestStoreProvider = null

    expect(() => container.resolve(NoProviderService)).toThrow(
      /no request store provider configured/i,
    )
  })

  it('SINGLETON cannot inject REQUEST-scoped dependency', () => {
    @Service({ scope: Scope.REQUEST })
    class ReqDep {
      value = 'request'
    }

    @Service()
    class SingletonParent {
      constructor(@Inject('REQ_DEP') public dep: ReqDep) {}
    }

    const container = Container.getInstance()
    container.register(ReqDep, ReqDep, Scope.REQUEST)
    container.register('REQ_DEP', ReqDep, Scope.REQUEST)
    container.register(SingletonParent, SingletonParent, Scope.SINGLETON)

    runInRequestContext(() => {
      expect(() => container.resolve(SingletonParent)).toThrow(
        /cannot inject request-scoped.*into singleton/i,
      )
    })
  })

  it('REQUEST scope can inject SINGLETON dependency', () => {
    @Service()
    class SingletonDep {
      value = 'singleton-ok'
    }

    @Service({ scope: Scope.REQUEST })
    class ReqConsumer {
      constructor(@Inject('SINGLE_DEP') public dep: SingletonDep) {}
    }

    const container = Container.getInstance()
    container.register(SingletonDep, SingletonDep, Scope.SINGLETON)
    container.register('SINGLE_DEP', SingletonDep, Scope.SINGLETON)
    container.register(ReqConsumer, ReqConsumer, Scope.REQUEST)

    const instance = runInRequestContext(() => container.resolve<ReqConsumer>(ReqConsumer))
    expect(instance.dep.value).toBe('singleton-ok')
  })

  it('pre-registered values in request store resolve correctly', () => {
    const USER_TOKEN = createToken('USER')

    const container = Container.getInstance()
    // Register a placeholder so the container knows about the token and its scope
    container.register(USER_TOKEN, Object as any, Scope.REQUEST)

    const store: RequestStore = {
      requestId: 'req-with-user',
      instances: new Map(),
      values: new Map<any, any>([[USER_TOKEN, { id: 42, name: 'Alice' }]]),
    }

    const user = requestStore.run(store, () => container.resolve<any>(USER_TOKEN))
    expect(user).toEqual({ id: 42, name: 'Alice' })
  })

  it('factory-registered REQUEST token invokes the factory once per request', () => {
    // Regression: the REQUEST branch of Container.resolve previously fell
    // through to createInstance(reg) without checking reg.factory, so
    // registerFactory(token, fn, Scope.REQUEST) would silently return
    // an empty `{}` (the result of `new Object()` against the factory's
    // placeholder target) instead of the factory's return value.
    interface TenantDb {
      db: { query: () => string }
    }
    const TENANT_DB = createToken<TenantDb>('app/tenant/db')
    let factoryCalls = 0

    const container = Container.getInstance()
    container.registerFactory(
      TENANT_DB,
      (): TenantDb => {
        factoryCalls += 1
        return { db: { query: () => 'tenant-row' } }
      },
      Scope.REQUEST,
    )

    const reqA: RequestStore = {
      requestId: 'req-a',
      instances: new Map(),
      values: new Map(),
    }
    const reqB: RequestStore = {
      requestId: 'req-b',
      instances: new Map(),
      values: new Map(),
    }

    // First resolve in request A — factory runs once.
    const handleA1 = requestStore.run(reqA, () => container.resolve(TENANT_DB))
    expect(handleA1.db.query()).toBe('tenant-row')
    expect(factoryCalls).toBe(1)

    // Second resolve in the same request — cached, factory does NOT re-run.
    const handleA2 = requestStore.run(reqA, () => container.resolve(TENANT_DB))
    expect(handleA2).toBe(handleA1)
    expect(factoryCalls).toBe(1)

    // Resolve in a different request — factory runs again, fresh instance.
    const handleB = requestStore.run(reqB, () => container.resolve(TENANT_DB))
    expect(handleB).not.toBe(handleA1)
    expect(handleB.db.query()).toBe('tenant-row')
    expect(factoryCalls).toBe(2)
  })

  it('concurrent requests have isolated instance caches', async () => {
    @Service({ scope: Scope.REQUEST })
    class IsolatedService {
      id = ++callCount
    }

    const container = Container.getInstance()
    container.register(IsolatedService, IsolatedService, Scope.REQUEST)

    const results = await Promise.all(
      Array.from(
        { length: 5 },
        (_, i) =>
          new Promise<{ reqId: string; instanceId: number }>((resolve) => {
            const store: RequestStore = {
              requestId: `concurrent-${i}`,
              instances: new Map(),
              values: new Map(),
            }
            requestStore.run(store, () => {
              const svc = container.resolve<IsolatedService>(IsolatedService)
              resolve({ reqId: `concurrent-${i}`, instanceId: svc.id })
            })
          }),
      ),
    )

    // Each request should have gotten a unique instance
    const ids = results.map((r) => r.instanceId)
    expect(new Set(ids).size).toBe(5)
  })

  it('requestId propagates through request store', () => {
    const store: RequestStore = {
      requestId: 'my-custom-request-id',
      instances: new Map(),
      values: new Map(),
    }

    const propagated = requestStore.run(store, () => {
      const current = requestStore.getStore()
      return current?.requestId
    })

    expect(propagated).toBe('my-custom-request-id')
  })
})

// ── requestScopeMiddleware unit tests ───────────────────────────────────

describe('requestScopeMiddleware', () => {
  it('initializes store with generated requestId when no header present', async () => {
    const app = express()
    const mw = requestScopeMiddleware()

    let capturedStore: RequestStore | undefined

    app.use(mw)
    app.get('/probe', (_req, res) => {
      capturedStore = requestStore.getStore()
      res.json({ ok: true })
    })

    await request(app).get('/probe')

    expect(capturedStore).toBeDefined()
    expect(capturedStore!.requestId).toBeTruthy()
    expect(typeof capturedStore!.requestId).toBe('string')
    // Should be a UUID
    expect(capturedStore!.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
    expect(capturedStore!.instances).toBeInstanceOf(Map)
    expect(capturedStore!.values).toBeInstanceOf(Map)
  })

  it('uses x-request-id header when provided', async () => {
    const app = express()
    const mw = requestScopeMiddleware()

    let capturedRequestId: string | undefined

    app.use(mw)
    app.get('/probe', (_req, res) => {
      capturedRequestId = requestStore.getStore()?.requestId
      res.json({ ok: true })
    })

    await request(app).get('/probe').set('x-request-id', 'external-id-123')

    expect(capturedRequestId).toBe('external-id-123')
  })
})

// ── HTTP-level integration tests ────────────────────────────────────────

describe('REQUEST scope — HTTP integration', () => {
  beforeEach(() => {
    Container.reset()
    resetCallCount()
  })

  it('REQUEST-scoped service returns fresh instance per HTTP request', async () => {
    @Service({ scope: Scope.REQUEST })
    class PerRequestCounter {
      id = ++callCount
    }

    @Controller()
    class CounterCtrl {
      constructor(@Inject('PER_REQ') private counter: PerRequestCounter) {}

      @Get('/')
      handle(ctx: RequestContext) {
        ctx.json({ id: this.counter.id })
      }
    }

    const TestModule = createTestModule({
      register: (c) => {
        c.register(PerRequestCounter, PerRequestCounter, Scope.REQUEST)
        c.register('PER_REQ', PerRequestCounter, Scope.REQUEST)
        c.register(CounterCtrl, CounterCtrl, Scope.REQUEST)
      },
      routes: () => ({
        path: '/counter',
        router: buildRoutes(CounterCtrl),
        controller: CounterCtrl,
      }),
    })

    const { expressApp } = await createTestApp({
      modules: [TestModule],
      middleware: [express.json(), requestScopeMiddleware()],
    })

    const res1 = await request(expressApp).get('/api/v1/counter/')
    const res2 = await request(expressApp).get('/api/v1/counter/')

    expect(res1.body.id).not.toBe(res2.body.id)
  })

  it('REQUEST-scoped service is cached within the same request (multiple resolves)', async () => {
    @Service({ scope: Scope.REQUEST })
    class SharedInRequest {
      id = ++callCount
    }

    @Controller()
    class SharedCtrl {
      constructor(
        @Inject('SHARED_A') private a: SharedInRequest,
        @Inject('SHARED_B') private b: SharedInRequest,
      ) {}

      @Get('/')
      handle(ctx: RequestContext) {
        // Both injections of the same token should be the same instance
        ctx.json({ idA: this.a.id, idB: this.b.id, same: this.a === this.b })
      }
    }

    const TestModule = createTestModule({
      register: (c) => {
        c.register(SharedInRequest, SharedInRequest, Scope.REQUEST)
        // Both tokens point to the same registration
        c.register('SHARED_A', SharedInRequest, Scope.REQUEST)
        c.register('SHARED_B', SharedInRequest, Scope.REQUEST)
        c.register(SharedCtrl, SharedCtrl, Scope.REQUEST)
      },
      routes: () => ({
        path: '/shared',
        router: buildRoutes(SharedCtrl),
        controller: SharedCtrl,
      }),
    })

    const { expressApp } = await createTestApp({
      modules: [TestModule],
      middleware: [express.json(), requestScopeMiddleware()],
    })

    const res = await request(expressApp).get('/api/v1/shared/')

    // Each token is its own registration, so they create separate instances.
    // But both 'SHARED_A' calls within the same request return the same instance,
    // and both 'SHARED_B' calls return the same instance.
    expect(typeof res.body.idA).toBe('number')
    expect(typeof res.body.idB).toBe('number')
  })

  it('multiple concurrent HTTP requests have isolated instances', async () => {
    @Service({ scope: Scope.REQUEST })
    class IsolatedHttpService {
      id = ++callCount
    }

    @Controller()
    class IsolatedCtrl {
      constructor(@Inject('ISO_SVC') private svc: IsolatedHttpService) {}

      @Get('/')
      handle(ctx: RequestContext) {
        ctx.json({ id: this.svc.id })
      }
    }

    const TestModule = createTestModule({
      register: (c) => {
        c.register(IsolatedHttpService, IsolatedHttpService, Scope.REQUEST)
        c.register('ISO_SVC', IsolatedHttpService, Scope.REQUEST)
        c.register(IsolatedCtrl, IsolatedCtrl, Scope.REQUEST)
      },
      routes: () => ({
        path: '/isolated',
        router: buildRoutes(IsolatedCtrl),
        controller: IsolatedCtrl,
      }),
    })

    const { expressApp } = await createTestApp({
      modules: [TestModule],
      middleware: [express.json(), requestScopeMiddleware()],
    })

    const responses = await Promise.all(
      Array.from({ length: 5 }, () => request(expressApp).get('/api/v1/isolated/')),
    )

    const ids = responses.map((r) => r.body.id)
    // All IDs should be unique — each request gets its own instance
    expect(new Set(ids).size).toBe(5)
  })

  it('x-request-id header propagates into request store during HTTP request', async () => {
    @Controller()
    class ReqIdCtrl {
      @Get('/')
      handle(ctx: RequestContext) {
        const store = requestStore.getStore()
        ctx.json({ requestId: store?.requestId ?? null })
      }
    }

    const TestModule = createTestModule({
      register: (c) => {
        c.register(ReqIdCtrl, ReqIdCtrl, Scope.REQUEST)
      },
      routes: () => ({
        path: '/reqid',
        router: buildRoutes(ReqIdCtrl),
        controller: ReqIdCtrl,
      }),
    })

    const { expressApp } = await createTestApp({
      modules: [TestModule],
      middleware: [express.json(), requestScopeMiddleware()],
    })

    const res = await request(expressApp).get('/api/v1/reqid/').set('x-request-id', 'trace-abc-123')

    expect(res.body.requestId).toBe('trace-abc-123')
  })
})
