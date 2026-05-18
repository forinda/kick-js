import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import type { Request, Response, NextFunction } from 'express'
import {
  Application,
  Container,
  Controller,
  Get,
  RequestContext,
  type AppAdapter,
  type AppModule,
  type ModuleRoutes,
} from '../src/index'

beforeEach(() => {
  Container.reset()
})

/**
 * Exercise the widened {@link MiddlewarePath} shape on `AdapterMiddleware`.
 * Path scope now accepts the same set Express's `app.use(path, …)` takes:
 *
 *   string | RegExp | (string | RegExp)[]
 *
 * These tests pin the runtime behaviour for each shape so a future
 * refactor of `mountMiddlewareList` (e.g. dropping the ReadonlyArray
 * spread) shows up as a regression here.
 */

@Controller()
class HelloController {
  @Get('/ping')
  ping(ctx: RequestContext) {
    ctx.json({ ok: true })
  }
}

@Controller()
class AdminController {
  @Get('/users')
  users(ctx: RequestContext) {
    ctx.json({ users: [] })
  }
}

class HelloModule implements AppModule {
  routes(): ModuleRoutes {
    return { path: '/hello', controller: HelloController }
  }
}

class AdminModule implements AppModule {
  routes(): ModuleRoutes {
    return { path: '/admin', controller: AdminController }
  }
}

function tap(trace: string[], label: string) {
  return (_req: Request, _res: Response, next: NextFunction) => {
    trace.push(label)
    next()
  }
}

describe('AdapterMiddleware.path — widened pattern shapes', () => {
  it('accepts a string prefix (existing behaviour, regression guard)', async () => {
    const trace: string[] = []
    const adapter: AppAdapter = {
      name: 'A',
      middleware: () => [
        { handler: tap(trace, 'fired'), phase: 'beforeRoutes', path: '/api/v1/hello' },
      ],
    }
    const app = new Application({
      modules: [new HelloModule(), new AdminModule()],
      adapters: [adapter],
      apiPrefix: '/api',
      defaultVersion: 1,
    })
    await app.setup()

    await request(app.getExpressApp()).get('/api/v1/hello/ping').expect(200)
    await request(app.getExpressApp()).get('/api/v1/admin/users').expect(200)
    // Fires only for the hello path.
    expect(trace).toEqual(['fired'])
  })

  it('accepts an array of string prefixes — fires for any matching prefix', async () => {
    const trace: string[] = []
    const adapter: AppAdapter = {
      name: 'A',
      middleware: () => [
        {
          handler: tap(trace, 'fired'),
          phase: 'beforeRoutes',
          path: ['/api/v1/hello', '/api/v1/admin'],
        },
      ],
    }
    const app = new Application({
      modules: [new HelloModule(), new AdminModule()],
      adapters: [adapter],
      apiPrefix: '/api',
      defaultVersion: 1,
    })
    await app.setup()

    await request(app.getExpressApp()).get('/api/v1/hello/ping').expect(200)
    await request(app.getExpressApp()).get('/api/v1/admin/users').expect(200)
    expect(trace).toEqual(['fired', 'fired'])
  })

  it('accepts a RegExp — pattern-matches the request URL', async () => {
    const trace: string[] = []
    const adapter: AppAdapter = {
      name: 'A',
      middleware: () => [
        {
          handler: tap(trace, 'fired'),
          phase: 'beforeRoutes',
          path: /^\/api\/v\d+\/hello/,
        },
      ],
    }
    const app = new Application({
      modules: [new HelloModule(), new AdminModule()],
      adapters: [adapter],
      apiPrefix: '/api',
      defaultVersion: 1,
    })
    await app.setup()

    await request(app.getExpressApp()).get('/api/v1/hello/ping').expect(200)
    await request(app.getExpressApp()).get('/api/v1/admin/users').expect(200)
    expect(trace).toEqual(['fired'])
  })

  it('accepts a mixed array of string + RegExp', async () => {
    const trace: string[] = []
    const adapter: AppAdapter = {
      name: 'A',
      middleware: () => [
        {
          handler: tap(trace, 'fired'),
          phase: 'beforeRoutes',
          path: ['/api/v1/admin', /^\/api\/v\d+\/hello/],
        },
      ],
    }
    const app = new Application({
      modules: [new HelloModule(), new AdminModule()],
      adapters: [adapter],
      apiPrefix: '/api',
      defaultVersion: 1,
    })
    await app.setup()

    await request(app.getExpressApp()).get('/api/v1/hello/ping').expect(200)
    await request(app.getExpressApp()).get('/api/v1/admin/users').expect(200)
    expect(trace).toEqual(['fired', 'fired'])
  })

  it('omitting path applies the middleware unconditionally', async () => {
    const trace: string[] = []
    const adapter: AppAdapter = {
      name: 'A',
      middleware: () => [{ handler: tap(trace, 'fired'), phase: 'beforeRoutes' }],
    }
    const app = new Application({
      modules: [new HelloModule()],
      adapters: [adapter],
      apiPrefix: '/api',
      defaultVersion: 1,
    })
    await app.setup()

    await request(app.getExpressApp()).get('/api/v1/hello/ping').expect(200)
    await request(app.getExpressApp()).get('/no-such-path').expect(404)
    // Fires for both, since no scope is declared.
    expect(trace).toEqual(['fired', 'fired'])
  })

  it('readonly array typed at the spec site survives Express mount (does not throw on use)', async () => {
    // Adopter declares the path as readonly (`as const`) — common
    // ergonomic shape for sharing constants. The framework must copy
    // it before handing to Express, which doesn't accept readonly arrays.
    const PATHS = ['/api/v1/hello', '/api/v1/admin'] as const
    const trace: string[] = []
    const adapter: AppAdapter = {
      name: 'A',
      middleware: () => [{ handler: tap(trace, 'fired'), phase: 'beforeRoutes', path: PATHS }],
    }
    const app = new Application({
      modules: [new HelloModule(), new AdminModule()],
      adapters: [adapter],
      apiPrefix: '/api',
      defaultVersion: 1,
    })
    // Setup must resolve normally (not reject) — the internal copy
    // handles the readonly → mutable boundary that Express's
    // PathParams type requires. `.resolves.toBeUndefined()` checks the
    // resolved-value side; if the promise rejected instead, vitest
    // would surface the rejection as the test failure.
    await expect(app.setup()).resolves.toBeUndefined()
    await request(app.getExpressApp()).get('/api/v1/hello/ping').expect(200)
    expect(trace).toEqual(['fired'])
  })
})
