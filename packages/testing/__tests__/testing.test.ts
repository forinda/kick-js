import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { createTestApp, createTestModule } from '@forinda/kickjs-testing'
import {
  Container,
  Service,
  Controller,
  Get,
  Inject,
  buildRoutes,
  type ModuleRoutes,
} from '@forinda/kickjs'

// ── Fixtures ───────────────────────────────────────────────────────────

const GREETING_TOKEN = Symbol('GREETING_TOKEN')

@Service()
class GreetingService {
  greet(name: string) {
    return `Hello, ${name}!`
  }
}

@Controller('/hello')
class HelloController {
  @Get('/')
  sayHello() {
    return { message: 'hello' }
  }
}

// ── createTestModule ───────────────────────────────────────────────────

describe('createTestModule', () => {
  beforeEach(() => {
    Container.reset()
  })

  it('returns a class that can be instantiated', () => {
    const TestModule = createTestModule({
      register: () => {},
      routes: () => null,
    })
    const instance = new TestModule()
    expect(instance).toBeDefined()
    expect(typeof instance.register).toBe('function')
    expect(typeof instance.routes).toBe('function')
  })

  it('register callback receives the container', () => {
    let receivedContainer: Container | null = null

    const TestModule = createTestModule({
      register: (c) => {
        receivedContainer = c
      },
      routes: () => null,
    })

    const container = Container.getInstance()
    const mod = new TestModule()
    mod.register(container)

    expect(receivedContainer).toBe(container)
  })

  it('routes callback returns the configured routes', () => {
    const routeConfig: ModuleRoutes = {
      path: '/test',
      router: buildRoutes(HelloController),
    }

    const TestModule = createTestModule({
      register: (c) => {
        c.register(HelloController, HelloController)
      },
      routes: () => routeConfig,
    })

    const mod = new TestModule()
    const routes = mod.routes()
    expect(routes).toBe(routeConfig)
  })

  it('routes callback can return an array of ModuleRoutes', () => {
    const routeConfigs: ModuleRoutes[] = [
      { path: '/a', router: buildRoutes(HelloController) },
      { path: '/b', router: buildRoutes(HelloController) },
    ]

    const TestModule = createTestModule({
      register: (c) => {
        c.register(HelloController, HelloController)
      },
      routes: () => routeConfigs,
    })

    const mod = new TestModule()
    const routes = mod.routes()
    expect(Array.isArray(routes)).toBe(true)
    expect(routes).toHaveLength(2)
  })

  it('routes callback can return null', () => {
    const TestModule = createTestModule({
      register: () => {},
      routes: () => null,
    })

    const mod = new TestModule()
    expect(mod.routes()).toBeNull()
  })
})

// ── createTestApp ──────────────────────────────────────────────────────

describe('createTestApp', () => {
  beforeEach(() => {
    Container.reset()
  })

  it('returns expressApp, app, and container', async () => {
    const TestModule = createTestModule({
      register: () => {},
      routes: () => null,
    })

    const result = await createTestApp({ modules: [TestModule] })

    expect(result).toHaveProperty('expressApp')
    expect(result).toHaveProperty('app')
    expect(result).toHaveProperty('container')
    expect(typeof result.expressApp).toBe('function') // Express app is a function
    expect(result.container).toBeInstanceOf(Container)
  })

  it('registers modules and makes services resolvable', async () => {
    const TestModule = createTestModule({
      register: (c) => {
        c.register(GreetingService, GreetingService)
      },
      routes: () => null,
    })

    const { container } = await createTestApp({ modules: [TestModule] })

    const svc = container.resolve(GreetingService)
    expect(svc).toBeInstanceOf(GreetingService)
    expect(svc.greet('World')).toBe('Hello, World!')
  })

  it('applies DI overrides after module registration', async () => {
    const realGreeting = { greet: () => 'real' }
    const fakeGreeting = { greet: () => 'fake' }

    const TestModule = createTestModule({
      register: (c) => {
        c.registerInstance(GREETING_TOKEN, realGreeting)
      },
      routes: () => null,
    })

    const { container } = await createTestApp({
      modules: [TestModule],
      overrides: { [GREETING_TOKEN]: fakeGreeting },
    })

    const resolved = container.resolve(GREETING_TOKEN)
    expect(resolved.greet()).toBe('fake')
  })

  it('applies string-keyed DI overrides', async () => {
    const TestModule = createTestModule({
      register: (c) => {
        c.registerInstance('config.apiUrl', 'https://real.api.com')
      },
      routes: () => null,
    })

    const { container } = await createTestApp({
      modules: [TestModule],
      overrides: { 'config.apiUrl': 'https://test.api.com' },
    })

    const url = container.resolve('config.apiUrl')
    expect(url).toBe('https://test.api.com')
  })
})

// ── Container isolation ────────────────────────────────────────────────

describe('container isolation', () => {
  beforeEach(() => {
    Container.reset()
  })

  it('uses global singleton by default (isolated=false)', async () => {
    const TestModule = createTestModule({
      register: () => {},
      routes: () => null,
    })

    const { container } = await createTestApp({ modules: [TestModule] })

    // The returned container should be the global singleton
    expect(container).toBe(Container.getInstance())
  })

  it('uses an isolated container when isolated=true', async () => {
    const TestModule = createTestModule({
      register: () => {},
      routes: () => null,
    })

    const { container } = await createTestApp({
      modules: [TestModule],
      isolated: true,
    })

    // The returned container should NOT be the global singleton
    expect(container).not.toBe(Container.getInstance())
    expect(container).toBeInstanceOf(Container)
  })

  it('isolated containers do not share state', async () => {
    const TOKEN = 'isolation-test-token'

    const TestModule = createTestModule({
      register: (c) => {
        c.registerInstance(TOKEN, 'from-module')
      },
      routes: () => null,
    })

    const { container: container1 } = await createTestApp({
      modules: [TestModule],
      isolated: true,
    })

    const { container: container2 } = await createTestApp({
      modules: [TestModule],
      isolated: true,
    })

    // Both containers have the token registered (via their own module registration)
    expect(container1.resolve(TOKEN)).toBe('from-module')
    expect(container2.resolve(TOKEN)).toBe('from-module')

    // Overriding in one does not affect the other
    container1.registerInstance(TOKEN, 'modified')
    expect(container1.resolve(TOKEN)).toBe('modified')
    expect(container2.resolve(TOKEN)).toBe('from-module')
  })
})

// ── Options forwarding ─────────────────────────────────────────────────

describe('createTestApp options', () => {
  beforeEach(() => {
    Container.reset()
  })

  it('accepts an empty modules array', async () => {
    const result = await createTestApp({ modules: [] })
    expect(result.expressApp).toBeDefined()
    expect(result.container).toBeInstanceOf(Container)
  })

  it('works without overrides', async () => {
    const TestModule = createTestModule({
      register: (c) => {
        c.registerInstance('key', 'value')
      },
      routes: () => null,
    })

    const { container } = await createTestApp({ modules: [TestModule] })
    expect(container.resolve('key')).toBe('value')
  })
})

// ── Bootstrap option forwarding ────────────────────────────────────────

describe('createTestApp bootstrap option forwarding', () => {
  beforeEach(() => {
    Container.reset()
  })

  it('forwards onNotFound to replace the default 404 handler', async () => {
    const TestModule = createTestModule({
      register: () => {},
      routes: () => null,
    })

    const { expressApp } = await createTestApp({
      modules: [TestModule],
      onNotFound: (_req, res) => {
        res.status(404).json({ error: 'custom-not-found', code: 'E_404' })
      },
    })

    const res = await request(expressApp).get('/api/v1/nope')
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'custom-not-found', code: 'E_404' })
  })

  it('forwards onError to replace the default error handler', async () => {
    @Controller('/boom')
    class BoomController {
      @Get('/')
      blow() {
        throw new Error('kaboom')
      }
    }

    const TestModule = createTestModule({
      register: (c) => {
        c.register(BoomController, BoomController)
      },
      routes: () => ({ path: '/boom', router: buildRoutes(BoomController) }),
    })

    const { expressApp } = await createTestApp({
      modules: [TestModule],
      onError: (err, _req, res, _next) => {
        res.status(500).json({ error: 'custom-envelope', message: err.message })
      },
    })

    const res = await request(expressApp).get('/api/v1/boom')
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'custom-envelope', message: 'kaboom' })
  })

  it('falls back to built-in handlers when onError/onNotFound are omitted', async () => {
    const TestModule = createTestModule({
      register: () => {},
      routes: () => null,
    })

    const { expressApp } = await createTestApp({ modules: [TestModule] })

    const res = await request(expressApp).get('/api/v1/missing')
    expect(res.status).toBe(404)
    // Built-in handler returns { message: 'Not Found' }
    expect(res.body).toHaveProperty('message')
  })
})
