/**
 * Phase 3 of `route-flags-design.md`: the connect-style `rateLimit()` runs
 * before route matching, so it reads flags from a table built at boot instead
 * of from `ctx.route`.
 *
 * The case that justifies keeping it pre-match at all is the last one here —
 * a request matching no route is still limited.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import {
  Application,
  Container,
  Controller,
  Get,
  defineRouteFlag,
  rateLimit,
  type AppModule,
  type ModuleRoutes,
  type RequestContext,
} from '../src/index'
import { RoutePolicyTable } from '../src/core/route-policy'

const Public = defineRouteFlag('auth.public')

const mod = (controller: unknown): AppModule =>
  ({ routes: (): ModuleRoutes => ({ path: '/t', controller }) }) as AppModule

describe('RoutePolicyTable', () => {
  it('matches a literal path', () => {
    const t = new RoutePolicyTable()
    t.add('GET', '/api/v1/health', new Map([['auth.public', true]]))
    expect(t.lookup('GET', '/api/v1/health').has('auth.public')).toBe(true)
    expect(t.lookup('GET', '/api/v1/other').size).toBe(0)
  })

  it('matches a param segment — what an exact path list cannot do', () => {
    const t = new RoutePolicyTable()
    t.add('POST', '/api/v1/webhooks/:provider', new Map([['csrf.exempt', true]]))
    expect(t.lookup('POST', '/api/v1/webhooks/stripe').has('csrf.exempt')).toBe(true)
    expect(t.lookup('POST', '/api/v1/webhooks/stripe/extra').size).toBe(0)
  })

  it('is method-scoped', () => {
    const t = new RoutePolicyTable()
    t.add('GET', '/api/v1/thing', new Map([['auth.public', true]]))
    expect(t.lookup('POST', '/api/v1/thing').size).toBe(0)
  })

  it('ignores routes with no flags, so lookups stay cheap', () => {
    const t = new RoutePolicyTable()
    t.add('GET', '/a', new Map())
    t.add('GET', '/b', undefined)
    t.add('GET', '/c', new Map([['x', true]]))
    expect(t.size).toBe(1)
  })

  it('tolerates a trailing slash', () => {
    const t = new RoutePolicyTable()
    t.add('GET', '/api/v1/health', new Map([['auth.public', true]]))
    expect(t.lookup('GET', '/api/v1/health/').has('auth.public')).toBe(true)
  })
})

describe('rateLimit({ exemptWhen }) — pre-match, flag-aware', () => {
  beforeEach(() => Container.reset())

  const makeController = () => {
    @Controller()
    class C {
      @Get('/limited')
      limited(ctx: RequestContext) {
        ctx.json({ ok: true })
      }

      @Public
      @Get('/health')
      health(ctx: RequestContext) {
        ctx.json({ ok: true })
      }

      @Public
      @Get('/probe/:name')
      probe(ctx: RequestContext) {
        ctx.json({ name: ctx.params.name })
      }
    }
    return C
  }

  const boot = async (options: Record<string, unknown>) => {
    const app = new Application({
      modules: [mod(makeController())],
      apiPrefix: '/api',
      defaultVersion: 1,
      ...options,
    } as never)
    await app.setup()
    return app
  }

  it('limits an unflagged route', async () => {
    const app = await boot({ middlewares: [rateLimit({ max: 1, exemptWhen: 'auth.public' })] })
    const h = app.handle.bind(app)
    const first = await request(h).get('/api/v1/t/limited')
    const second = await request(h).get('/api/v1/t/limited')
    expect({ first: first.status, second: second.status }).toEqual({ first: 200, second: 429 })
  })

  it('exempts a flagged route, before the route is matched', async () => {
    const app = await boot({ middlewares: [rateLimit({ max: 1, exemptWhen: 'auth.public' })] })
    const h = app.handle.bind(app)
    const statuses: number[] = []
    for (let i = 0; i < 4; i++) statuses.push((await request(h).get('/api/v1/t/health')).status)
    expect(statuses).toEqual([200, 200, 200, 200])
  })

  it('exempts a flagged route with a param — `skipPaths` cannot express this', async () => {
    const app = await boot({ middlewares: [rateLimit({ max: 1, exemptWhen: 'auth.public' })] })
    const h = app.handle.bind(app)
    const first = await request(h).get('/api/v1/t/probe/alpha')
    const second = await request(h).get('/api/v1/t/probe/beta')
    expect({ first: first.status, second: second.status }).toEqual({ first: 200, second: 200 })
  })

  it('still limits a request that matches no route at all', async () => {
    // The reason this middleware stays pre-match: a route-scoped guard never
    // sees this traffic, and an abuse control must.
    const app = await boot({ middlewares: [rateLimit({ max: 1, exemptWhen: 'auth.public' })] })
    const h = app.handle.bind(app)
    const first = await request(h).get('/api/v1/t/nope')
    const second = await request(h).get('/api/v1/t/nope')
    expect({ first: first.status, second: second.status }).toEqual({ first: 404, second: 429 })
  })

  it('a list and a predicate work the same as everywhere else', async () => {
    const app = await boot({
      middlewares: [rateLimit({ max: 1, exemptWhen: ['nope.one', 'auth.public'] })],
    })
    const h = app.handle.bind(app)
    const statuses = [
      (await request(h).get('/api/v1/t/health')).status,
      (await request(h).get('/api/v1/t/health')).status,
    ]
    expect(statuses).toEqual([200, 200])
  })

  it('without exemptWhen nothing changes', async () => {
    const app = await boot({ middlewares: [rateLimit({ max: 1 })] })
    const h = app.handle.bind(app)
    const first = await request(h).get('/api/v1/t/health')
    const second = await request(h).get('/api/v1/t/health')
    expect({ first: first.status, second: second.status }).toEqual({ first: 200, second: 429 })
  })
})
