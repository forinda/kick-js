/**
 * Integration tests for dependency injection across packages —
 * covers token-based injection, @Autowired(TOKEN), implementation
 * swapping, and the full controller → service → repository pipeline.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import 'reflect-metadata'
import request from 'supertest'
import {
  Container,
  Scope,
  Controller,
  Get,
  Service,
  Autowired,
  Inject,
} from '@forinda/kickjs-core'
import { buildRoutes, RequestContext } from '@forinda/kickjs-http'
import { createTestApp, createTestModule } from '@forinda/kickjs-testing'

function reg(cls: any, container: Container) {
  if (!container.has(cls)) container.register(cls, cls, Scope.SINGLETON)
}

// ── @Autowired(TOKEN) property injection ──────────────────────────────

describe('DI: @Autowired(TOKEN) property injection', () => {
  beforeEach(() => Container.reset())

  it('controller resolves service by token via @Autowired(TOKEN)', async () => {
    const GREETER = Symbol('Greeter')

    @Service()
    class FormalGreeter {
      greet(name: string) {
        return `Good day, ${name}`
      }
    }

    @Controller()
    class GreetCtrl {
      @Autowired(GREETER) private greeter!: FormalGreeter

      @Get('/:name')
      hello(ctx: RequestContext) {
        ctx.json({ message: this.greeter.greet(ctx.params.name) })
      }
    }

    const TestModule = createTestModule({
      register: (c) => {
        reg(FormalGreeter, c)
        reg(GreetCtrl, c)
        c.registerFactory(GREETER, () => c.resolve(FormalGreeter))
      },
      routes: () => ({ path: '/greet', router: buildRoutes(GreetCtrl), controller: GreetCtrl }),
    })

    const { expressApp } = await createTestApp({ modules: [TestModule] })

    const res = await request(expressApp).get('/api/v1/greet/Alice')
    expect(res.status).toBe(200)
    expect(res.body.message).toBe('Good day, Alice')
  })
})

// ── Implementation swapping ───────────────────────────────────────────

describe('DI: implementation swapping via module registration', () => {
  beforeEach(() => Container.reset())

  it('swapping implementation only requires module change', async () => {
    const REPO = Symbol('Repo')

    class InMemoryRepo {
      getAll() {
        return [{ id: 1, source: 'memory' }]
      }
    }
    class MockRepo {
      getAll() {
        return [{ id: 1, source: 'mock' }]
      }
    }

    @Controller()
    class DataCtrl {
      @Autowired(REPO) private repo!: any

      @Get('/')
      list(ctx: RequestContext) {
        ctx.json(this.repo.getAll())
      }
    }

    // Bound to InMemoryRepo
    const ModuleA = createTestModule({
      register: (c) => {
        reg(InMemoryRepo, c)
        reg(DataCtrl, c)
        c.registerFactory(REPO, () => c.resolve(InMemoryRepo))
      },
      routes: () => ({ path: '/data', router: buildRoutes(DataCtrl), controller: DataCtrl }),
    })

    const { expressApp: app1 } = await createTestApp({ modules: [ModuleA] })
    const res1 = await request(app1).get('/api/v1/data/')
    expect(res1.body[0].source).toBe('memory')

    // Swap to MockRepo — only registration changes
    Container.reset()

    const ModuleB = createTestModule({
      register: (c) => {
        reg(MockRepo, c)
        reg(DataCtrl, c)
        c.registerFactory(REPO, () => c.resolve(MockRepo))
      },
      routes: () => ({ path: '/data', router: buildRoutes(DataCtrl), controller: DataCtrl }),
    })

    const { expressApp: app2 } = await createTestApp({ modules: [ModuleB] })
    const res2 = await request(app2).get('/api/v1/data/')
    expect(res2.body[0].source).toBe('mock')
  })
})

// ── Controller → Service → Repository pipeline ───────────────────────

describe('DI: full controller → service → repository pipeline', () => {
  beforeEach(() => Container.reset())

  it('request flows through controller, service, and repository layers', async () => {
    const TASK_REPO = Symbol('TaskRepo')

    class InMemoryTaskRepo {
      private tasks = [
        { id: '1', title: 'Write tests', done: false },
        { id: '2', title: 'Ship feature', done: true },
      ]

      findAll() {
        return this.tasks
      }

      findById(id: string) {
        return this.tasks.find((t) => t.id === id) ?? null
      }
    }

    @Service()
    class TaskService {
      constructor(@Inject(TASK_REPO) private repo: InMemoryTaskRepo) {}

      list() {
        return this.repo.findAll()
      }

      get(id: string) {
        return this.repo.findById(id)
      }
    }

    @Controller()
    class TaskCtrl {
      @Autowired() private svc!: TaskService

      @Get('/')
      list(ctx: RequestContext) {
        ctx.json(this.svc.list())
      }

      @Get('/:id')
      get(ctx: RequestContext) {
        const task = this.svc.get(ctx.params.id)
        if (!task) return ctx.notFound('Task not found')
        ctx.json(task)
      }
    }

    const TestModule = createTestModule({
      register: (c) => {
        reg(InMemoryTaskRepo, c)
        reg(TaskService, c)
        reg(TaskCtrl, c)
        c.registerFactory(TASK_REPO, () => c.resolve(InMemoryTaskRepo))
      },
      routes: () => ({ path: '/tasks', router: buildRoutes(TaskCtrl), controller: TaskCtrl }),
    })

    // Simulate design:paramtypes for constructor injection
    Reflect.defineMetadata('design:paramtypes', [InMemoryTaskRepo], TaskService)
    // Simulate design:type for @Autowired property
    Reflect.defineMetadata('design:type', TaskService, TaskCtrl.prototype, 'svc')

    const { expressApp } = await createTestApp({ modules: [TestModule] })

    const listRes = await request(expressApp).get('/api/v1/tasks/')
    expect(listRes.status).toBe(200)
    expect(listRes.body).toHaveLength(2)

    const getRes = await request(expressApp).get('/api/v1/tasks/1')
    expect(getRes.status).toBe(200)
    expect(getRes.body.title).toBe('Write tests')

    const notFoundRes = await request(expressApp).get('/api/v1/tasks/999')
    expect(notFoundRes.status).toBe(404)
  })
})

// ── DI overrides via createTestApp ────────────────────────────────────

describe('DI: test overrides', () => {
  beforeEach(() => Container.reset())

  it('createTestApp overrides replace real implementations', async () => {
    const CONFIG = Symbol('Config')

    @Controller()
    class ConfigCtrl {
      @Autowired(CONFIG) private config!: any

      @Get('/')
      index(ctx: RequestContext) {
        ctx.json({ env: this.config.env })
      }
    }

    const TestModule = createTestModule({
      register: (c) => {
        reg(ConfigCtrl, c)
        // Module would normally register real config here
        c.registerFactory(CONFIG, () => ({ env: 'production' }))
      },
      routes: () => ({ path: '/config', router: buildRoutes(ConfigCtrl) }),
    })

    // Override with test config
    const { expressApp } = await createTestApp({
      modules: [TestModule],
      overrides: { [CONFIG]: { env: 'test' } },
    })

    const res = await request(expressApp).get('/api/v1/config/')
    expect(res.status).toBe(200)
    expect(res.body.env).toBe('test')
  })
})
