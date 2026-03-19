import { describe, it, expect, beforeEach } from 'vitest'
import 'reflect-metadata'
import {
  Container,
  Scope,
  Controller,
  Get,
  Service,
  Autowired,
  type AppModule,
  type ModuleRoutes,
} from '@kickjs/core'
import { Application, buildRoutes, RequestContext } from '@kickjs/http'

/** Register a class in the container (decorator may have fired on old instance) */
function reg(cls: any, container: Container) {
  if (!container.has(cls)) container.register(cls, cls, Scope.SINGLETON)
}

describe('Application', () => {
  beforeEach(() => {
    Container.reset()
  })

  // ── Setup ─────────────────────────────────────────────────────────

  it('creates an Application with modules', () => {
    @Controller()
    class HealthCtrl {
      @Get('/') check(ctx: RequestContext) { ctx.json({ ok: true }) }
    }

    class HealthModule implements AppModule {
      register(container: Container) { reg(HealthCtrl, container) }
      routes(): ModuleRoutes {
        return { path: '/health', router: buildRoutes(HealthCtrl) }
      }
    }

    const app = new Application({ modules: [HealthModule], middleware: [] })
    expect(app).toBeDefined()
  })

  it('setup() mounts routes and middleware without starting server', () => {
    @Controller()
    class TestCtrl {
      @Get('/') handle(ctx: RequestContext) { ctx.json({ test: true }) }
    }

    class TestModule implements AppModule {
      register(container: Container) { reg(TestCtrl, container) }
      routes(): ModuleRoutes {
        return { path: '/test', router: buildRoutes(TestCtrl) }
      }
    }

    const app = new Application({ modules: [TestModule], middleware: [] })
    expect(() => { ;(app as any).setup() }).not.toThrow()
    expect(app.getExpressApp()).toBeDefined()
  })

  it('configures apiPrefix and versioning', () => {
    @Controller()
    class V2Ctrl {
      @Get('/') handle(ctx: RequestContext) { ctx.json({}) }
    }

    class V2Module implements AppModule {
      register(container: Container) { reg(V2Ctrl, container) }
      routes(): ModuleRoutes {
        return { path: '/items', router: buildRoutes(V2Ctrl), version: 2 }
      }
    }

    const app = new Application({
      modules: [V2Module],
      apiPrefix: '/api',
      defaultVersion: 1,
      middleware: [],
    })

    // setup() should complete without error for versioned routes
    expect(() => { ;(app as any).setup() }).not.toThrow()
    expect(app.getExpressApp()).toBeDefined()
  })

  // ── Adapters ──────────────────────────────────────────────────────

  it('calls adapter lifecycle hooks during setup', () => {
    const hooks: string[] = []

    const testAdapter = {
      name: 'TestAdapter',
      beforeMount: () => hooks.push('beforeMount'),
      beforeStart: () => hooks.push('beforeStart'),
      middleware: () => [],
    }

    @Controller()
    class Ctrl {
      @Get('/') handle(ctx: RequestContext) { ctx.json({}) }
    }

    class Mod implements AppModule {
      register(container: Container) { reg(Ctrl, container) }
      routes(): ModuleRoutes {
        return { path: '/x', router: buildRoutes(Ctrl) }
      }
    }

    const app = new Application({
      modules: [Mod],
      adapters: [testAdapter],
      middleware: [],
    })

    ;(app as any).setup()

    expect(hooks).toContain('beforeMount')
    expect(hooks).toContain('beforeStart')
    expect(hooks.indexOf('beforeMount')).toBeLessThan(hooks.indexOf('beforeStart'))
  })

  it('onRouteMount is called for adapters when controller is provided', () => {
    const mounted: string[] = []

    const spyAdapter = {
      name: 'SpyAdapter',
      onRouteMount: (ctrl: any, path: string) => {
        mounted.push(`${ctrl.name}@${path}`)
      },
    }

    @Controller()
    class SpyCtrl {
      @Get('/') handle(ctx: RequestContext) { ctx.json({}) }
    }

    class SpyModule implements AppModule {
      register(container: Container) { reg(SpyCtrl, container) }
      routes(): ModuleRoutes {
        return { path: '/spy', router: buildRoutes(SpyCtrl), controller: SpyCtrl }
      }
    }

    const app = new Application({
      modules: [SpyModule],
      adapters: [spyAdapter],
      middleware: [],
    })

    ;(app as any).setup()

    expect(mounted.length).toBe(1)
    expect(mounted[0]).toContain('SpyCtrl')
    expect(mounted[0]).toContain('/spy')
  })

  // ── Shutdown ──────────────────────────────────────────────────────

  it('shutdown() calls adapter shutdown hooks with allSettled', async () => {
    const shutdowns: string[] = []

    const adapterA = { name: 'A', shutdown: async () => { shutdowns.push('A') } }
    const adapterB = { name: 'B', shutdown: async () => { throw new Error('B failed') } }
    const adapterC = { name: 'C', shutdown: async () => { shutdowns.push('C') } }

    @Controller()
    class Ctrl {
      @Get('/') handle(ctx: RequestContext) { ctx.json({}) }
    }

    class Mod implements AppModule {
      register(container: Container) { reg(Ctrl, container) }
      routes(): ModuleRoutes {
        return { path: '/x', router: buildRoutes(Ctrl) }
      }
    }

    const app = new Application({
      modules: [Mod],
      adapters: [adapterA, adapterB, adapterC],
      middleware: [],
    })

    ;(app as any).setup()

    // Should not throw even though B fails
    await expect(app.shutdown()).resolves.toBeUndefined()
    expect(shutdowns).toContain('A')
    expect(shutdowns).toContain('C')
  })

  // ── Rebuild (HMR) ────────────────────────────────────────────────

  it('rebuild() creates a fresh Express app and resets container', () => {
    @Controller()
    class RebuildCtrl {
      @Get('/') handle(ctx: RequestContext) { ctx.json({}) }
    }

    class RebuildModule implements AppModule {
      register(container: Container) { reg(RebuildCtrl, container) }
      routes(): ModuleRoutes {
        return { path: '/r', router: buildRoutes(RebuildCtrl) }
      }
    }

    const app = new Application({ modules: [RebuildModule], middleware: [] })
    ;(app as any).setup()
    const firstApp = app.getExpressApp()

    app.rebuild()
    const secondApp = app.getExpressApp()
    expect(firstApp).not.toBe(secondApp)
  })

  // ── Middleware pipeline ───────────────────────────────────────────

  it('uses custom middleware pipeline when provided', () => {
    const customMw = (_req: any, _res: any, next: any) => { next() }

    @Controller()
    class Ctrl {
      @Get('/') handle(ctx: RequestContext) { ctx.json({}) }
    }

    class Mod implements AppModule {
      register(container: Container) { reg(Ctrl, container) }
      routes(): ModuleRoutes {
        return { path: '/m', router: buildRoutes(Ctrl) }
      }
    }

    const app = new Application({ modules: [Mod], middleware: [customMw] })
    // setup() should complete without error when custom middleware provided
    expect(() => { ;(app as any).setup() }).not.toThrow()
    expect(app.getExpressApp()).toBeDefined()
  })

  // ── Multiple modules ──────────────────────────────────────────────

  it('mounts multiple modules with separate paths', () => {
    @Controller()
    class ACtrl { @Get('/') handle(ctx: RequestContext) { ctx.json({ a: true }) } }

    @Controller()
    class BCtrl { @Get('/') handle(ctx: RequestContext) { ctx.json({ b: true }) } }

    class ModA implements AppModule {
      register(container: Container) { reg(ACtrl, container) }
      routes(): ModuleRoutes { return { path: '/a', router: buildRoutes(ACtrl) } }
    }

    class ModB implements AppModule {
      register(container: Container) { reg(BCtrl, container) }
      routes(): ModuleRoutes { return { path: '/b', router: buildRoutes(BCtrl) } }
    }

    const app = new Application({ modules: [ModA, ModB], middleware: [] })
    expect(() => { ;(app as any).setup() }).not.toThrow()
  })
})
