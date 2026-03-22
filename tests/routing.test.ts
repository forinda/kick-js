/**
 * Integration tests for HTTP routing — covers route mounting,
 * path resolution, middleware pipeline, and RequestContext.
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
} from '@forinda/kickjs-core'
import { buildRoutes, RequestContext } from '@forinda/kickjs-http'
import { createTestApp, createTestModule } from '@forinda/kickjs-testing'

function reg(cls: any, container: Container) {
  if (!container.has(cls)) container.register(cls, cls, Scope.SINGLETON)
}

// ── Route mounting ────────────────────────────────────────────────────

describe('Routing: module route mounting', () => {
  beforeEach(() => Container.reset())

  it('routes are accessible at /api/v1/{module_path}/{route_path}', async () => {
    @Controller()
    class TodoCtrl {
      @Get('/')
      list(ctx: RequestContext) {
        ctx.json({ todos: [] })
      }

      @Get('/:id')
      get(ctx: RequestContext) {
        ctx.json({ id: ctx.params.id })
      }

      @Post('/')
      create(ctx: RequestContext) {
        ctx.created({ id: '1', ...ctx.body })
      }
    }

    const TestModule = createTestModule({
      register: (c) => reg(TodoCtrl, c),
      routes: () => ({ path: '/todos', router: buildRoutes(TodoCtrl), controller: TodoCtrl }),
    })

    const { expressApp } = createTestApp({ modules: [TestModule] })

    const listRes = await request(expressApp).get('/api/v1/todos/')
    expect(listRes.status).toBe(200)
    expect(listRes.body.todos).toEqual([])

    const getRes = await request(expressApp).get('/api/v1/todos/abc')
    expect(getRes.status).toBe(200)
    expect(getRes.body.id).toBe('abc')

    const createRes = await request(expressApp)
      .post('/api/v1/todos/')
      .send({ title: 'Test' })
    expect(createRes.status).toBe(201)
    expect(createRes.body.title).toBe('Test')
  })

  it('unmatched routes return 404', async () => {
    @Controller()
    class EmptyCtrl {
      @Get('/')
      index(ctx: RequestContext) {
        ctx.json({ ok: true })
      }
    }

    const TestModule = createTestModule({
      register: (c) => reg(EmptyCtrl, c),
      routes: () => ({ path: '/exists', router: buildRoutes(EmptyCtrl) }),
    })

    const { expressApp } = createTestApp({ modules: [TestModule] })

    const res = await request(expressApp).get('/api/v1/nope')
    expect(res.status).toBe(404)
  })
})

// ── Path doubling prevention (KICK-007) ───────────────────────────────

describe('Routing: no path doubling (KICK-007)', () => {
  beforeEach(() => Container.reset())

  it('module path + controller path does not double', async () => {
    @Controller('/items')
    class ItemsCtrl {
      @Get('/list')
      list(ctx: RequestContext) {
        ctx.json({ items: [] })
      }
    }

    const TestModule = createTestModule({
      register: (c) => reg(ItemsCtrl, c),
      routes: () => ({ path: '/items', router: buildRoutes(ItemsCtrl), controller: ItemsCtrl }),
    })

    const { expressApp } = createTestApp({ modules: [TestModule] })

    const res = await request(expressApp).get('/api/v1/items/list')
    expect(res.status).toBe(200)
    expect(res.body.items).toEqual([])

    const doubled = await request(expressApp).get('/api/v1/items/items/list')
    expect(doubled.status).toBe(404)
  })
})

// ── Module path '/' does not produce double slash ─────────────────────

describe('Routing: module path "/" does not produce double slash', () => {
  beforeEach(() => Container.reset())

  it('path: "/" mounts at /api/v1 without trailing slash', async () => {
    @Controller()
    class ProjectCtrl {
      @Get('/projects/:id')
      get(ctx: RequestContext) {
        ctx.json({ id: ctx.params.id })
      }
    }

    const TestModule = createTestModule({
      register: (c) => reg(ProjectCtrl, c),
      routes: () => ({ path: '/', router: buildRoutes(ProjectCtrl), controller: ProjectCtrl }),
    })

    const { expressApp } = createTestApp({ modules: [TestModule] })

    // Should be /api/v1/projects/123, NOT /api/v1//projects/123
    const res = await request(expressApp).get('/api/v1/projects/abc')
    expect(res.status).toBe(200)
    expect(res.body.id).toBe('abc')
  })
})

// ── Null routes for non-HTTP modules (KICK-003) ──────────────────────

describe('Routing: null routes for non-HTTP modules (KICK-003)', () => {
  beforeEach(() => Container.reset())

  it('HTTP and non-HTTP modules coexist without crashing', async () => {
    @Controller()
    class HealthCtrl {
      @Get('/')
      check(ctx: RequestContext) {
        ctx.json({ status: 'ok' })
      }
    }

    const HttpModule = createTestModule({
      register: (c) => reg(HealthCtrl, c),
      routes: () => ({ path: '/health', router: buildRoutes(HealthCtrl) }),
    })

    const WorkerModule = createTestModule({
      register: () => {},
      routes: () => null,
    })

    const { expressApp } = createTestApp({ modules: [HttpModule, WorkerModule] })

    const res = await request(expressApp).get('/api/v1/health/')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
  })
})

// ── Multiple modules ──────────────────────────────────────────────────

describe('Routing: multiple modules', () => {
  beforeEach(() => Container.reset())

  it('mounts multiple modules at separate paths', async () => {
    @Controller()
    class UsersCtrl {
      @Get('/')
      list(ctx: RequestContext) {
        ctx.json({ type: 'users' })
      }
    }

    @Controller()
    class PostsCtrl {
      @Get('/')
      list(ctx: RequestContext) {
        ctx.json({ type: 'posts' })
      }
    }

    const UsersModule = createTestModule({
      register: (c) => reg(UsersCtrl, c),
      routes: () => ({ path: '/users', router: buildRoutes(UsersCtrl) }),
    })

    const PostsModule = createTestModule({
      register: (c) => reg(PostsCtrl, c),
      routes: () => ({ path: '/posts', router: buildRoutes(PostsCtrl) }),
    })

    const { expressApp } = createTestApp({ modules: [UsersModule, PostsModule] })

    const usersRes = await request(expressApp).get('/api/v1/users/')
    expect(usersRes.body.type).toBe('users')

    const postsRes = await request(expressApp).get('/api/v1/posts/')
    expect(postsRes.body.type).toBe('posts')
  })
})
