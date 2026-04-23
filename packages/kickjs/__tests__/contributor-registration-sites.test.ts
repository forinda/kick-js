import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import {
  Container,
  Controller,
  Get,
  RequestContext,
  buildRoutes,
  defineContextDecorator,
  requestScopeMiddleware,
  type AppModule,
  type AppAdapter,
  type KickPlugin,
  type ModuleRoutes,
  type ContributorRegistration,
  type SourcedRegistration,
} from '../src/index'

beforeEach(() => {
  Container.reset()
})

/**
 * Build a tiny Express app behind requestScopeMiddleware that mounts a single
 * controller with explicit external sources. Bypasses Application — exercises
 * the buildRoutes() externalSources option directly.
 */
function appWithExternalSources(
  controllerClass: any,
  externalSources: SourcedRegistration[],
): express.Express {
  const app = express()
  app.use(requestScopeMiddleware())
  app.use('/', buildRoutes(controllerClass, { externalSources }))
  return app
}

// ── Each level reaches the handler ─────────────────────────────────────

describe('contributor sources — module level', () => {
  it('module-level contributor populates ctx for the controller routes', async () => {
    const LoadTenant: ContributorRegistration = defineContextDecorator({
      key: 'tenant',
      resolve: () => ({ id: 't-from-module' }),
    }).registration

    @Controller()
    class C {
      @Get('/me')
      me(ctx: RequestContext) {
        return ctx.json({ tenant: ctx.get('tenant') })
      }
    }

    const app = appWithExternalSources(C, [
      { source: 'module', registration: LoadTenant, label: 'TestModule' },
    ])
    const res = await request(app).get('/me')
    expect(res.body).toEqual({ tenant: { id: 't-from-module' } })
  })
})

describe('contributor sources — adapter level', () => {
  it('adapter-level contributor populates ctx', async () => {
    const LoadFlags: ContributorRegistration = defineContextDecorator({
      key: 'flags',
      resolve: () => ({ beta: true }),
    }).registration

    @Controller()
    class C {
      @Get('/me')
      me(ctx: RequestContext) {
        return ctx.json({ flags: ctx.get('flags') })
      }
    }

    const app = appWithExternalSources(C, [
      { source: 'adapter', registration: LoadFlags, label: 'FlagsAdapter' },
    ])
    const res = await request(app).get('/me')
    expect(res.body).toEqual({ flags: { beta: true } })
  })
})

describe('contributor sources — global level', () => {
  it('global (bootstrap) contributor populates ctx', async () => {
    const StartedAt: ContributorRegistration = defineContextDecorator({
      key: 'requestStartedAt',
      resolve: () => 12345,
    }).registration

    @Controller()
    class C {
      @Get('/me')
      me(ctx: RequestContext) {
        return ctx.json({ startedAt: ctx.get('requestStartedAt') })
      }
    }

    const app = appWithExternalSources(C, [
      { source: 'global', registration: StartedAt, label: 'bootstrap' },
    ])
    const res = await request(app).get('/me')
    expect(res.body).toEqual({ startedAt: 12345 })
  })
})

// ── Cross-level precedence ──────────────────────────────────────────────

describe('contributor sources — cross-level precedence', () => {
  it('method-level beats global for the same key', async () => {
    const MethodLoad = defineContextDecorator({
      key: 'tenant',
      resolve: () => ({ id: 'method-wins' }),
    })
    const globalReg: ContributorRegistration = defineContextDecorator({
      key: 'tenant',
      resolve: () => ({ id: 'global-loses' }),
    }).registration

    @Controller()
    class C {
      @MethodLoad
      @Get('/me')
      me(ctx: RequestContext) {
        return ctx.json(ctx.get('tenant'))
      }
    }

    const app = appWithExternalSources(C, [
      { source: 'global', registration: globalReg, label: 'bootstrap' },
    ])
    const res = await request(app).get('/me')
    expect(res.body).toEqual({ id: 'method-wins' })
  })

  it('module beats adapter beats global for the same key', async () => {
    const moduleReg: ContributorRegistration = defineContextDecorator({
      key: 'tenant',
      resolve: () => ({ id: 'module-wins' }),
    }).registration
    const adapterReg: ContributorRegistration = defineContextDecorator({
      key: 'tenant',
      resolve: () => ({ id: 'adapter-loses' }),
    }).registration
    const globalReg: ContributorRegistration = defineContextDecorator({
      key: 'tenant',
      resolve: () => ({ id: 'global-loses' }),
    }).registration

    @Controller()
    class C {
      @Get('/me')
      me(ctx: RequestContext) {
        return ctx.json(ctx.get('tenant'))
      }
    }

    const app = appWithExternalSources(C, [
      { source: 'module', registration: moduleReg, label: 'M' },
      { source: 'adapter', registration: adapterReg, label: 'A' },
      { source: 'global', registration: globalReg, label: 'G' },
    ])
    const res = await request(app).get('/me')
    expect(res.body).toEqual({ id: 'module-wins' })
  })

  it('adapter beats global when no module entry exists', async () => {
    const adapterReg: ContributorRegistration = defineContextDecorator({
      key: 'tenant',
      resolve: () => ({ id: 'adapter-wins' }),
    }).registration
    const globalReg: ContributorRegistration = defineContextDecorator({
      key: 'tenant',
      resolve: () => ({ id: 'global-loses' }),
    }).registration

    @Controller()
    class C {
      @Get('/me')
      me(ctx: RequestContext) {
        return ctx.json(ctx.get('tenant'))
      }
    }

    const app = appWithExternalSources(C, [
      { source: 'adapter', registration: adapterReg, label: 'A' },
      { source: 'global', registration: globalReg, label: 'G' },
    ])
    const res = await request(app).get('/me')
    expect(res.body).toEqual({ id: 'adapter-wins' })
  })
})

// ── dependsOn across levels ─────────────────────────────────────────────

describe('contributor sources — dependsOn across levels', () => {
  it('a method-level contributor can dependsOn a global-level key', async () => {
    const globalTenant: ContributorRegistration = defineContextDecorator({
      key: 'tenant',
      resolve: () => ({ id: 't-7' }),
    }).registration
    const LoadProject = defineContextDecorator({
      key: 'project',
      dependsOn: ['tenant'],
      resolve: (ctx) => {
        const tenant = ctx.get('tenant') as { id: string } | undefined
        return { id: 'p-1', tenantId: tenant?.id }
      },
    })

    @Controller()
    class C {
      @LoadProject
      @Get('/me')
      me(ctx: RequestContext) {
        return ctx.json(ctx.get('project'))
      }
    }

    const app = appWithExternalSources(C, [
      { source: 'global', registration: globalTenant, label: 'bootstrap' },
    ])
    const res = await request(app).get('/me')
    expect(res.body).toEqual({ id: 'p-1', tenantId: 't-7' })
  })
})

// ── Per-module isolation via Application threading ─────────────────────

describe('contributor sources — Application threading + per-module isolation', () => {
  it('Application threads adapter + global to every module; per-module stays scoped', async () => {
    const adapterReg: ContributorRegistration = defineContextDecorator({
      key: 'fromAdapter',
      resolve: () => 'adapter-value',
    }).registration
    const globalReg: ContributorRegistration = defineContextDecorator({
      key: 'fromGlobal',
      resolve: () => 'global-value',
    }).registration
    const moduleAReg: ContributorRegistration = defineContextDecorator({
      key: 'fromModuleA',
      resolve: () => 'A-value',
    }).registration
    const moduleBReg: ContributorRegistration = defineContextDecorator({
      key: 'fromModuleB',
      resolve: () => 'B-value',
    }).registration

    @Controller()
    class ControllerA {
      @Get('/probe')
      probe(ctx: RequestContext) {
        return ctx.json({
          adapter: ctx.get('fromAdapter'),
          global: ctx.get('fromGlobal'),
          a: ctx.get('fromModuleA'),
          b: ctx.get('fromModuleB') ?? null, // must NOT leak from module B
        })
      }
    }

    @Controller()
    class ControllerB {
      @Get('/probe')
      probe(ctx: RequestContext) {
        return ctx.json({
          adapter: ctx.get('fromAdapter'),
          global: ctx.get('fromGlobal'),
          a: ctx.get('fromModuleA') ?? null, // must NOT leak from module A
          b: ctx.get('fromModuleB'),
        })
      }
    }

    class ModuleA implements AppModule {
      contributors() {
        return [moduleAReg]
      }
      routes(): ModuleRoutes {
        return { path: '/a', router: buildRoutes(ControllerA), controller: ControllerA }
      }
    }

    class ModuleB implements AppModule {
      contributors() {
        return [moduleBReg]
      }
      routes(): ModuleRoutes {
        return { path: '/b', router: buildRoutes(ControllerB), controller: ControllerB }
      }
    }

    class TestAdapter implements AppAdapter {
      name = 'TestAdapter'
      contributors() {
        return [adapterReg]
      }
    }

    const { Application } = await import('../src/index')
    const app = new Application({
      modules: [ModuleA, ModuleB],
      adapters: [new TestAdapter()],
      contributors: [globalReg],
      apiPrefix: '/api',
      defaultVersion: 1,
    })
    await app.setup()

    const aRes = await request(app.getExpressApp()).get('/api/v1/a/probe')
    expect(aRes.body).toEqual({
      adapter: 'adapter-value',
      global: 'global-value',
      a: 'A-value',
      b: null,
    })

    const bRes = await request(app.getExpressApp()).get('/api/v1/b/probe')
    expect(bRes.body).toEqual({
      adapter: 'adapter-value',
      global: 'global-value',
      a: null,
      b: 'B-value',
    })
  })
})

// ── Plugin-level contributors (#107) ────────────────────────────────────

describe('contributor sources — plugin level (KickPlugin.contributors)', () => {
  it('a plugin contributing directly behaves like an adapter contributor', async () => {
    const PluginCtx: ContributorRegistration = defineContextDecorator({
      key: 'fromPlugin',
      resolve: () => 'plugin-value',
    }).registration

    @Controller()
    class Ctrl {
      @Get('/')
      probe(ctx: RequestContext) {
        return ctx.json({ fromPlugin: ctx.get('fromPlugin') })
      }
    }

    class TestModule implements AppModule {
      routes(): ModuleRoutes {
        return { path: '/probe', router: buildRoutes(Ctrl), controller: Ctrl }
      }
    }

    class TestPlugin implements KickPlugin {
      name = 'TestPlugin'
      contributors() {
        return [PluginCtx]
      }
    }

    const { Application } = await import('../src/index')
    const app = new Application({
      modules: [TestModule],
      plugins: [new TestPlugin()],
      apiPrefix: '/api',
      defaultVersion: 1,
    })
    await app.setup()

    const res = await request(app.getExpressApp()).get('/api/v1/probe')
    expect(res.body).toEqual({ fromPlugin: 'plugin-value' })
  })

  it('module-level contributor overrides a plugin-level one with the same key', async () => {
    const PluginVersion: ContributorRegistration = defineContextDecorator({
      key: 'tenant',
      resolve: () => ({ id: 'plugin-loses' }),
    }).registration
    const ModuleVersion: ContributorRegistration = defineContextDecorator({
      key: 'tenant',
      resolve: () => ({ id: 'module-wins' }),
    }).registration

    @Controller()
    class Ctrl {
      @Get('/')
      probe(ctx: RequestContext) {
        return ctx.json(ctx.get('tenant'))
      }
    }

    class OverrideModule implements AppModule {
      contributors() {
        return [ModuleVersion]
      }
      routes(): ModuleRoutes {
        return { path: '/probe', router: buildRoutes(Ctrl), controller: Ctrl }
      }
    }

    class TestPlugin implements KickPlugin {
      name = 'TestPlugin'
      contributors() {
        return [PluginVersion]
      }
    }

    const { Application } = await import('../src/index')
    const app = new Application({
      modules: [OverrideModule],
      plugins: [new TestPlugin()],
      apiPrefix: '/api',
      defaultVersion: 1,
    })
    await app.setup()

    const res = await request(app.getExpressApp()).get('/api/v1/probe')
    expect(res.body).toEqual({ id: 'module-wins' })
  })

  it('a plugin-shipped adapter and a plugin-direct contributor coexist', async () => {
    const FromAdapter: ContributorRegistration = defineContextDecorator({
      key: 'fromAdapter',
      resolve: () => 'adapter-value',
    }).registration
    const FromPlugin: ContributorRegistration = defineContextDecorator({
      key: 'fromPlugin',
      resolve: () => 'plugin-value',
    }).registration

    @Controller()
    class Ctrl {
      @Get('/')
      probe(ctx: RequestContext) {
        return ctx.json({
          fromAdapter: ctx.get('fromAdapter'),
          fromPlugin: ctx.get('fromPlugin'),
        })
      }
    }

    class TestModule implements AppModule {
      routes(): ModuleRoutes {
        return { path: '/probe', router: buildRoutes(Ctrl), controller: Ctrl }
      }
    }

    class BundledAdapter implements AppAdapter {
      name = 'BundledAdapter'
      contributors() {
        return [FromAdapter]
      }
    }

    class BundlePlugin implements KickPlugin {
      name = 'BundlePlugin'
      adapters() {
        return [new BundledAdapter()]
      }
      contributors() {
        return [FromPlugin]
      }
    }

    const { Application } = await import('../src/index')
    const app = new Application({
      modules: [TestModule],
      plugins: [new BundlePlugin()],
      apiPrefix: '/api',
      defaultVersion: 1,
    })
    await app.setup()

    const res = await request(app.getExpressApp()).get('/api/v1/probe')
    expect(res.body).toEqual({
      fromAdapter: 'adapter-value',
      fromPlugin: 'plugin-value',
    })
  })
})
