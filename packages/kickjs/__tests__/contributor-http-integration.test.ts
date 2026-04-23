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
  ContributorCycleError,
  MissingContributorError,
} from '../src/index'

// ── Helpers ─────────────────────────────────────────────────────────────

/** Build a tiny Express app that mounts a controller behind requestScopeMiddleware. */
function appWithController(controllerClass: any) {
  const app = express()
  app.use(requestScopeMiddleware())
  app.use('/', buildRoutes(controllerClass))
  return app
}

beforeEach(() => {
  Container.reset()
})

// ── Method-level contributor → handler ──────────────────────────────────

describe('contributor pipeline → router-builder integration', () => {
  it('a method-level contributor populates ctx; the handler reads it back', async () => {
    const LoadTenant = defineContextDecorator({
      key: 'tenant',
      resolve: () => ({ id: 't-7', name: 'Acme' }),
    })

    @Controller()
    class TenantController {
      @LoadTenant
      @Get('/me')
      me(ctx: RequestContext) {
        return ctx.json({ tenant: ctx.get('tenant') })
      }
    }

    const res = await request(appWithController(TenantController)).get('/me')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ tenant: { id: 't-7', name: 'Acme' } })
  })

  it('class-level + method-level contributors both run', async () => {
    const LoadTenantClass = defineContextDecorator({
      key: 'tenant',
      resolve: () => ({ id: 't-class' }),
    })
    const LoadProjectMethod = defineContextDecorator({
      key: 'project',
      resolve: () => ({ id: 'p-method' }),
    })

    @LoadTenantClass
    @Controller()
    class MixedController {
      @LoadProjectMethod
      @Get('/data')
      data(ctx: RequestContext) {
        return ctx.json({
          tenant: ctx.get('tenant'),
          project: ctx.get('project'),
        })
      }
    }

    const res = await request(appWithController(MixedController)).get('/data')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      tenant: { id: 't-class' },
      project: { id: 'p-method' },
    })
  })

  it('dependsOn across class+method runs in topo order', async () => {
    const order: string[] = []

    const LoadTenant = defineContextDecorator({
      key: 'tenant',
      resolve: () => {
        order.push('tenant')
        return { id: 't-dep' }
      },
    })
    const LoadProject = defineContextDecorator({
      key: 'project',
      dependsOn: ['tenant'],
      resolve: (ctx) => {
        order.push('project')
        const tenant = ctx.get('tenant') as { id: string } | undefined
        return { id: 'p-1', tenantId: tenant?.id }
      },
    })

    @LoadTenant
    @Controller()
    class ChainController {
      @LoadProject
      @Get('/chain')
      chain(ctx: RequestContext) {
        return ctx.json(ctx.get('project'))
      }
    }

    const res = await request(appWithController(ChainController)).get('/chain')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ id: 'p-1', tenantId: 't-dep' })
    expect(order).toEqual(['tenant', 'project'])
  })

  it('optional contributor swallows errors; handler still runs with key unset', async () => {
    const FailingOptional = defineContextDecorator({
      key: 'flaky',
      optional: true,
      resolve: () => {
        throw new Error('upstream-down')
      },
    })

    @Controller()
    class OptionalController {
      @FailingOptional
      @Get('/lenient')
      lenient(ctx: RequestContext) {
        return ctx.json({ flaky: ctx.get('flaky') ?? null })
      }
    }

    const res = await request(appWithController(OptionalController)).get('/lenient')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ flaky: null })
  })

  it('a non-optional resolve failure forwards to the error handler', async () => {
    const Hard = defineContextDecorator({
      key: 'hard',
      resolve: () => {
        throw new Error('boom')
      },
    })

    @Controller()
    class StrictController {
      @Hard
      @Get('/strict')
      strict(ctx: RequestContext) {
        return ctx.json({ ok: true })
      }
    }

    const app = express()
    app.use(requestScopeMiddleware())
    app.use('/', buildRoutes(StrictController))
    app.use((err: any, _req: any, res: any, _next: any) => {
      res.status(500).json({ error: err.message })
    })

    const res = await request(app).get('/strict')
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'boom' })
  })

  it('controller with no contributors skips the runner middleware entirely', async () => {
    @Controller()
    class PlainController {
      @Get('/plain')
      plain(ctx: RequestContext) {
        return ctx.json({ ok: true })
      }
    }

    // Indirect signal: route still works and no error is raised.
    const res = await request(appWithController(PlainController)).get('/plain')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })
})

// ── Mount-time validation (boot fails on misconfiguration) ──────────────

describe('contributor pipeline → mount-time validation', () => {
  it('buildRoutes throws MissingContributorError when dependsOn is unsatisfied', () => {
    const NeedsTenant = defineContextDecorator({
      key: 'project',
      dependsOn: ['tenant'],
      resolve: () => ({ id: 'p-1' }),
    })

    @Controller()
    class BrokenController {
      @NeedsTenant
      @Get('/x')
      x(ctx: RequestContext) {
        return ctx.json({})
      }
    }

    expect(() => buildRoutes(BrokenController)).toThrowError(MissingContributorError)
  })

  it('buildRoutes throws ContributorCycleError when contributors form a cycle', () => {
    const A = defineContextDecorator({
      key: 'a',
      dependsOn: ['b'],
      resolve: () => 'a',
    })
    const B = defineContextDecorator({
      key: 'b',
      dependsOn: ['a'],
      resolve: () => 'b',
    })

    @Controller()
    class CycleController {
      @A
      @B
      @Get('/cycle')
      cycle(ctx: RequestContext) {
        return ctx.json({})
      }
    }

    expect(() => buildRoutes(CycleController)).toThrowError(ContributorCycleError)
  })
})
