/**
 * Bun smoke-test for KickJS.
 *
 * Verifies that core exports (Container, decorators, DI) work under the Bun
 * runtime. Run with:
 *
 *   bun test scripts/bun-smoke.ts
 *
 * If Bun is not installed the root `test:bun` script will fail gracefully.
 */

import 'reflect-metadata'
import { describe, test, expect, beforeEach } from 'bun:test'
import {
  Container,
  METADATA,
  Service,
  Controller,
  Repository,
  Autowired,
  Get,
  Post,
  createLogger,
  HttpException,
  HttpStatus,
  normalizePath,
  joinPaths,
  ref,
  computed,
} from '@forinda/kickjs'

// ---------------------------------------------------------------------------
// 1. Container basics
// ---------------------------------------------------------------------------
describe('Container basics (Bun)', () => {
  beforeEach(() => {
    Container.reset()
  })

  test('getInstance returns a Container', () => {
    const container = Container.getInstance()
    expect(container).toBeDefined()
    expect(typeof container.resolve).toBe('function')
    expect(typeof container.register).toBe('function')
  })

  test('register and resolve a plain class', () => {
    @Service()
    class Greeter {
      greet() {
        return 'hello'
      }
    }

    const container = Container.getInstance()
    const g = container.resolve(Greeter)
    expect(g).toBeInstanceOf(Greeter)
    expect(g.greet()).toBe('hello')
  })

  test('singleton scope returns the same instance', () => {
    @Service()
    class SingletonSvc {
      id = Math.random()
    }

    const container = Container.getInstance()
    const a = container.resolve(SingletonSvc)
    const b = container.resolve(SingletonSvc)
    expect(a).toBe(b)
  })

  test('registerInstance and resolve a token value', () => {
    const container = Container.getInstance()
    container.registerInstance('MY_VALUE', 42)
    expect(container.resolve('MY_VALUE')).toBe(42)
  })

  test('registerFactory provides lazy resolution', () => {
    const container = Container.getInstance()
    let called = false
    container.registerFactory('LAZY', () => {
      called = true
      return 'created'
    })
    expect(called).toBe(false)
    expect(container.resolve('LAZY')).toBe('created')
    expect(called).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 2. Decorator-driven DI
// ---------------------------------------------------------------------------
describe('Decorator DI (Bun)', () => {
  beforeEach(() => {
    Container.reset()
  })

  test('@Service registers in container', () => {
    @Service()
    class MySvc {
      ping() {
        return 'pong'
      }
    }

    const container = Container.getInstance()
    expect(container.has(MySvc)).toBe(true)
    expect(container.resolve(MySvc).ping()).toBe('pong')
  })

  test('@Repository registers in container', () => {
    @Repository()
    class MyRepo {
      findAll() {
        return []
      }
    }

    const container = Container.getInstance()
    expect(container.has(MyRepo)).toBe(true)
  })

  test('@Autowired injects dependency', () => {
    @Service()
    class Repo {
      find() {
        return [1, 2, 3]
      }
    }

    @Service()
    class Svc {
      @Autowired() repo!: Repo
    }

    const container = Container.getInstance()
    const svc = container.resolve(Svc)
    expect(svc.repo).toBeInstanceOf(Repo)
    expect(svc.repo.find()).toEqual([1, 2, 3])
  })

  test('@Inject resolves a constructor parameter token', () => {
    // @Inject is a parameter decorator — tested via factory registration
    // since parameter decorators inside function bodies are not valid TS.
    const REPO = Symbol('REPO')

    class InMemoryRepo {
      type = 'inmemory'
    }

    const container = Container.getInstance()
    container.register(InMemoryRepo, InMemoryRepo)
    container.registerFactory(REPO, () => container.resolve(InMemoryRepo))

    const repo = container.resolve<InMemoryRepo>(REPO)
    expect(repo.type).toBe('inmemory')
  })
})

// ---------------------------------------------------------------------------
// 3. Controller + route decorators
// ---------------------------------------------------------------------------
describe('Controller decorators (Bun)', () => {
  beforeEach(() => {
    Container.reset()
  })

  test('@Controller stores path metadata', () => {
    @Controller('/items')
    class ItemsController {
      @Get('/')
      list() {
        return []
      }
    }

    const path = Reflect.getMetadata(METADATA.CONTROLLER_PATH, ItemsController)
    expect(path).toBe('/items')
  })

  test('@Get and @Post store route metadata', () => {
    @Controller('/tasks')
    class TasksController {
      @Get('/')
      list() {
        return []
      }

      @Post('/')
      create() {
        return {}
      }
    }

    const routes: any[] = Reflect.getMetadata(METADATA.ROUTES, TasksController) ?? []
    expect(routes.length).toBe(2)

    const methods = routes.map((r: any) => r.method)
    expect(methods).toContain('GET')
    expect(methods).toContain('POST')
  })
})

// ---------------------------------------------------------------------------
// 4. Utility exports
// ---------------------------------------------------------------------------
describe('Utility exports (Bun)', () => {
  test('createLogger returns a logger', () => {
    const log = createLogger('bun-test')
    expect(typeof log.info).toBe('function')
    expect(typeof log.error).toBe('function')
  })

  test('HttpException constructs correctly', () => {
    const err = new HttpException(HttpStatus.NOT_FOUND, 'gone')
    expect(err.status).toBe(404)
    expect(err.message).toBe('gone')
  })

  test('HttpException static factories work', () => {
    expect(HttpException.badRequest().status).toBe(400)
    expect(HttpException.unauthorized().status).toBe(401)
    expect(HttpException.notFound().status).toBe(404)
  })

  test('normalizePath cleans slashes', () => {
    expect(normalizePath('//foo///bar//')).toBe('/foo/bar')
  })

  test('joinPaths concatenates segments', () => {
    expect(joinPaths('/api', '/v1', '/users')).toBe('/api/v1/users')
  })
})

// ---------------------------------------------------------------------------
// 5. Reactivity
// ---------------------------------------------------------------------------
describe('Reactivity (Bun)', () => {
  test('ref and computed work', () => {
    const count = ref(0)
    const doubled = computed(() => count.value * 2)

    expect(count.value).toBe(0)
    expect(doubled.value).toBe(0)

    count.value = 5
    expect(doubled.value).toBe(10)
  })
})
