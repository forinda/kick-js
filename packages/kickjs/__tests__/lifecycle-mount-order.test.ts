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
  type KickPlugin,
  type ModuleRoutes,
  type MiddlewareEntry,
} from '../src/index'

beforeEach(() => {
  Container.reset()
})

/**
 * Locks in the documented Application.setup() lifecycle order
 * (application.ts §373-385):
 *
 *   Hooks fired during setup():
 *     1. adapter.beforeMount()
 *     2. plugin.register()                 (DI binding only)
 *     3. (request-time middleware installed but not yet running)
 *    11. adapter.beforeStart()
 *
 *   Per-request middleware chain (declaration order within each phase):
 *     1. adapter.middleware() phase=beforeGlobal
 *     2. plugin.middleware()
 *     3. user-declared global middleware (options.middleware)
 *     4. adapter.middleware() phase=afterGlobal
 *     5. adapter.middleware() phase=beforeRoutes
 *     6. module route handler
 *     7. adapter.middleware() phase=afterRoutes   (only if route called next())
 *
 *   Only fires under start(), not setup():
 *     adapter.afterStart()
 *
 * Multiple adapters within the same phase fire in dependsOn-sorted
 * order; the existing application-mount-sort.test.ts covers the sort,
 * this file covers the per-phase RUNTIME order through the actual
 * Express middleware stack.
 */

type Trace = string[]

/** Pluck a tagged adapter with the full set of lifecycle hooks. */
function buildTracingAdapter(trace: Trace, name: string): AppAdapter {
  return {
    name,
    beforeMount: () => {
      trace.push(`${name}:beforeMount`)
    },
    middleware: () => [
      {
        phase: 'beforeGlobal',
        handler: (_req: Request, _res: Response, next: NextFunction) => {
          trace.push(`${name}:beforeGlobal-mw`)
          next()
        },
      },
      {
        phase: 'afterGlobal',
        handler: (_req: Request, _res: Response, next: NextFunction) => {
          trace.push(`${name}:afterGlobal-mw`)
          next()
        },
      },
      {
        phase: 'beforeRoutes',
        handler: (_req: Request, _res: Response, next: NextFunction) => {
          trace.push(`${name}:beforeRoutes-mw`)
          next()
        },
      },
      {
        phase: 'afterRoutes',
        handler: (_req: Request, _res: Response, next: NextFunction) => {
          trace.push(`${name}:afterRoutes-mw`)
          next()
        },
      },
    ],
    beforeStart: () => {
      trace.push(`${name}:beforeStart`)
    },
    afterStart: () => {
      trace.push(`${name}:afterStart`)
    },
  }
}

function buildTracingPlugin(trace: Trace, name: string): KickPlugin {
  return {
    name,
    register: () => {
      trace.push(`${name}:register`)
    },
    middleware: () => [
      (_req: Request, _res: Response, next: NextFunction) => {
        trace.push(`${name}:middleware`)
        next()
      },
    ],
  }
}

function buildTracingModule(trace: Trace): AppModule {
  @Controller()
  class TraceController {
    @Get('/ping')
    ping(ctx: RequestContext) {
      trace.push('route:handler')
      ctx.json({ ok: true })
    }
  }
  return {
    routes(): ModuleRoutes {
      return { path: '/trace', controller: TraceController }
    },
  }
}

function userMiddleware(trace: Trace, label: string): MiddlewareEntry {
  return (_req: Request, _res: Response, next: NextFunction) => {
    trace.push(label)
    next()
  }
}

describe('Application lifecycle mount order', () => {
  it('adapter.beforeMount + plugin.register fire during setup() in declared order', async () => {
    const trace: Trace = []
    const app = new Application({
      modules: [],
      adapters: [buildTracingAdapter(trace, 'A1'), buildTracingAdapter(trace, 'A2')],
      plugins: [buildTracingPlugin(trace, 'P1'), buildTracingPlugin(trace, 'P2')],
      // No user middleware → uses framework defaults; doesn't affect lifecycle-hook ordering
    })
    await app.setup()
    // beforeMount for every adapter fires before any plugin.register()
    // (plugin.register() runs in §3b, beforeMount in §1). beforeStart
    // for every adapter fires at the very end.
    const idx = (label: string) => trace.indexOf(label)
    expect(idx('A1:beforeMount')).toBeLessThan(idx('A2:beforeMount'))
    expect(idx('A2:beforeMount')).toBeLessThan(idx('P1:register'))
    expect(idx('P1:register')).toBeLessThan(idx('P2:register'))
    expect(idx('P2:register')).toBeLessThan(idx('A1:beforeStart'))
    expect(idx('A1:beforeStart')).toBeLessThan(idx('A2:beforeStart'))
  })

  it('afterStart does NOT fire under setup() — only start()', async () => {
    const trace: Trace = []
    const app = new Application({
      modules: [],
      adapters: [buildTracingAdapter(trace, 'Solo')],
    })
    await app.setup()
    expect(trace).toContain('Solo:beforeMount')
    expect(trace).toContain('Solo:beforeStart')
    expect(trace).not.toContain('Solo:afterStart')
  })

  it('per-request middleware fires in documented phase order for a matched route', async () => {
    const trace: Trace = []
    const app = new Application({
      modules: [buildTracingModule(trace)],
      adapters: [buildTracingAdapter(trace, 'A')],
      plugins: [buildTracingPlugin(trace, 'P')],
      middleware: [userMiddleware(trace, 'user-global-mw')],
      apiPrefix: '/api',
      defaultVersion: 1,
    })
    await app.setup()

    // Reset trace AFTER setup so we only assert on the per-request slice.
    trace.length = 0

    await request(app.getExpressApp()).get('/api/v1/trace/ping').expect(200)

    // Phases per application.ts §3 → §7:
    //   beforeGlobal (adapter) → plugin middleware → user global →
    //   afterGlobal (adapter) → beforeRoutes (adapter) → route handler
    // afterRoutes does NOT fire here because the route handler ended
    // the response without calling next() — see the next test for that.
    expect(trace).toEqual([
      'A:beforeGlobal-mw',
      'P:middleware',
      'user-global-mw',
      'A:afterGlobal-mw',
      'A:beforeRoutes-mw',
      'route:handler',
    ])
  })

  it('afterRoutes middleware fires for an unmatched path that falls through to 404', async () => {
    const trace: Trace = []
    const app = new Application({
      modules: [buildTracingModule(trace)],
      adapters: [buildTracingAdapter(trace, 'A')],
      middleware: [],
      apiPrefix: '/api',
      defaultVersion: 1,
    })
    await app.setup()
    trace.length = 0

    await request(app.getExpressApp()).get('/no-such-path').expect(404)

    // Same chain as the matched-route case, but instead of the route
    // handler firing, the request falls past the route mount and hits
    // afterRoutes before the 404 handler responds.
    expect(trace).toEqual([
      'A:beforeGlobal-mw',
      'A:afterGlobal-mw',
      'A:beforeRoutes-mw',
      'A:afterRoutes-mw',
    ])
  })

  it('multiple adapters fire each phase in dependsOn-topological order', async () => {
    const trace: Trace = []
    // AuthAdapter depends on TenantAdapter — sort must put Tenant first
    // in every phase. Each adapter's hook tags itself, so an out-of-order
    // run shows up as a flipped pair in the assertion.
    const tenant = buildTracingAdapter(trace, 'Tenant')
    const auth = { ...buildTracingAdapter(trace, 'Auth'), dependsOn: ['Tenant' as const] }
    const app = new Application({
      modules: [buildTracingModule(trace)],
      adapters: [auth, tenant], // declared out of order intentionally
      apiPrefix: '/api',
      defaultVersion: 1,
    })
    await app.setup()
    trace.length = 0
    await request(app.getExpressApp()).get('/api/v1/trace/ping').expect(200)

    // Within each phase, Tenant's middleware runs before Auth's because
    // the constructor topo-sorted Tenant ahead of Auth.
    const seen = trace.filter((s) => s.endsWith('-mw'))
    const tenantIdx = seen.findIndex((s) => s.startsWith('Tenant'))
    const authIdx = seen.findIndex((s) => s.startsWith('Auth'))
    expect(tenantIdx).toBeGreaterThanOrEqual(0)
    expect(authIdx).toBeGreaterThanOrEqual(0)
    expect(tenantIdx).toBeLessThan(authIdx)
    // Spot-check every phase: Tenant's variant must precede Auth's variant.
    for (const phase of [
      'beforeGlobal-mw',
      'afterGlobal-mw',
      'beforeRoutes-mw',
    ] as const) {
      expect(trace.indexOf(`Tenant:${phase}`)).toBeLessThan(trace.indexOf(`Auth:${phase}`))
    }
  })

  it('plugin middleware fires BEFORE user-declared global middleware', async () => {
    // The framework mounts plugin.middleware() in §3c, before §4 (user
    // global). Test guards against accidentally swapping those phases —
    // adopters write middleware expecting plugin context to be ready.
    const trace: Trace = []
    const app = new Application({
      modules: [buildTracingModule(trace)],
      plugins: [buildTracingPlugin(trace, 'P')],
      middleware: [userMiddleware(trace, 'user-mw')],
      apiPrefix: '/api',
      defaultVersion: 1,
    })
    await app.setup()
    trace.length = 0
    await request(app.getExpressApp()).get('/api/v1/trace/ping').expect(200)
    expect(trace.indexOf('P:middleware')).toBeLessThan(trace.indexOf('user-mw'))
  })
})
