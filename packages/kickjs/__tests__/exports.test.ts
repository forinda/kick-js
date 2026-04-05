import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import {
  Container,
  Scope,
  Inject,
  Service,
  Controller,
  Get,
  buildRoutes,
  RequestContext,
} from '../src/index'
import { createTestApp, createTestModule } from '@forinda/kickjs-testing'

function reg(cls: any, container: Container) {
  if (!container.has(cls)) container.register(cls, cls, Scope.SINGLETON)
}

describe('@forinda/kickjs unified exports', () => {
  it('exports core DI', async () => {
    const { Container, Scope } = await import('../src/index')
    expect(Container).toBeDefined()
    expect(typeof Container.getInstance).toBe('function')
    expect(typeof Container.reset).toBe('function')
    expect(typeof Container.create).toBe('function')
    expect(Scope.SINGLETON).toBeDefined()
  })

  it('exports decorators', async () => {
    const {
      Service, Controller, Get, Post, Put, Delete, Patch,
      Autowired, Inject, Value, Middleware,
    } = await import('../src/index')
    expect(typeof Service).toBe('function')
    expect(typeof Controller).toBe('function')
    expect(typeof Get).toBe('function')
    expect(typeof Post).toBe('function')
    expect(typeof Put).toBe('function')
    expect(typeof Delete).toBe('function')
    expect(typeof Patch).toBe('function')
    expect(typeof Autowired).toBe('function')
    expect(typeof Inject).toBe('function')
    expect(typeof Value).toBe('function')
    expect(typeof Middleware).toBe('function')
  })

  it('exports errors', async () => {
    const { HttpException, HttpStatus } = await import('../src/index')
    expect(typeof HttpException).toBe('function')
    expect(HttpStatus.OK).toBe(200)
    expect(HttpStatus.NOT_FOUND).toBe(404)
  })

  it('exports logger', async () => {
    const { createLogger, Logger } = await import('../src/index')
    expect(typeof createLogger).toBe('function')
    expect(typeof Logger).toBe('function')
  })

  it('exports reactivity', async () => {
    const { ref, computed, watch, reactive } = await import('../src/index')
    expect(typeof ref).toBe('function')
    expect(typeof computed).toBe('function')
    expect(typeof watch).toBe('function')
    expect(typeof reactive).toBe('function')
  })

  it('exports Application and bootstrap', async () => {
    const { Application, bootstrap } = await import('../src/index')
    expect(typeof Application).toBe('function')
    expect(typeof bootstrap).toBe('function')
  })

  it('exports RequestContext and buildRoutes', async () => {
    const { RequestContext, buildRoutes } = await import('../src/index')
    expect(typeof RequestContext).toBe('function')
    expect(typeof buildRoutes).toBe('function')
  })

  it('exports middleware factories', async () => {
    const { helmet, cors, csrf, rateLimit, requestId, requestLogger } = await import('../src/index')
    expect(typeof helmet).toBe('function')
    expect(typeof cors).toBe('function')
    expect(typeof csrf).toBe('function')
    expect(typeof rateLimit).toBe('function')
    expect(typeof requestId).toBe('function')
    expect(typeof requestLogger).toBe('function')
  })

  it('exports query parsing', async () => {
    const { parseQuery, FILTER_OPERATORS } = await import('../src/index')
    expect(typeof parseQuery).toBe('function')
    expect(typeof FILTER_OPERATORS).toBe('object')
  })

  it('exports path utilities', async () => {
    const { normalizePath, joinPaths } = await import('../src/index')
    expect(normalizePath('//foo///bar//')).toBe('/foo/bar')
    expect(joinPaths('/api', '/v1', '/users')).toBe('/api/v1/users')
  })
})

// ── DI: implementation swapping ──────────────────────────────────────

describe('DI: implementation swapping via unified package', () => {
  beforeEach(() => Container.reset())

  it('swapping factory re-registers with new implementation', () => {
    const REPO = Symbol('REPO')

    class InMemoryRepo {
      type = 'inmemory'
    }
    class PostgresRepo {
      type = 'postgres'
    }

    @Service()
    class MyService {
      constructor(@Inject(REPO) public repo: any) {}
    }

    const container = Container.getInstance()
    container.register(InMemoryRepo, InMemoryRepo)
    container.register(PostgresRepo, PostgresRepo)
    container.register(MyService, MyService)
    container.registerFactory(REPO, () => container.resolve(InMemoryRepo))

    let svc = container.resolve<MyService>(MyService)
    expect(svc.repo.type).toBe('inmemory')

    // Swap — reset and re-register with PostgresRepo factory
    Container.reset()
    const c2 = Container.getInstance()
    c2.register(InMemoryRepo, InMemoryRepo)
    c2.register(PostgresRepo, PostgresRepo)
    c2.register(MyService, MyService)
    c2.registerFactory(REPO, () => c2.resolve(PostgresRepo))

    svc = c2.resolve<MyService>(MyService)
    expect(svc.repo.type).toBe('postgres')
  })

  it('swapped implementation works through full HTTP pipeline', async () => {
    const DATA_SOURCE = Symbol('DATA_SOURCE')

    class MemorySource {
      getData() {
        return [{ id: 1, source: 'memory' }]
      }
    }
    class MockSource {
      getData() {
        return [{ id: 1, source: 'mock' }]
      }
    }

    @Controller()
    class DataCtrl {
      constructor(@Inject(DATA_SOURCE) private ds: any) {}

      @Get('/')
      list(ctx: RequestContext) {
        ctx.json(this.ds.getData())
      }
    }

    // Phase 1: MemorySource
    const ModuleA = createTestModule({
      register: (c) => {
        reg(MemorySource, c)
        reg(DataCtrl, c)
        c.registerFactory(DATA_SOURCE, () => c.resolve(MemorySource))
      },
      routes: () => ({ path: '/data', router: buildRoutes(DataCtrl), controller: DataCtrl }),
    })

    const { expressApp: app1 } = await createTestApp({ modules: [ModuleA] })
    const res1 = await request(app1).get('/api/v1/data/')
    expect(res1.body[0].source).toBe('memory')

    // Phase 2: Swap to MockSource
    const ModuleB = createTestModule({
      register: (c) => {
        reg(MockSource, c)
        reg(DataCtrl, c)
        c.registerFactory(DATA_SOURCE, () => c.resolve(MockSource))
      },
      routes: () => ({ path: '/data', router: buildRoutes(DataCtrl), controller: DataCtrl }),
    })

    const { expressApp: app2 } = await createTestApp({ modules: [ModuleB] })
    const res2 = await request(app2).get('/api/v1/data/')
    expect(res2.body[0].source).toBe('mock')
  })
})
