/**
 * Phase 2 of `route-flags-design.md`: the guards that can see a route read its
 * flags, so "this endpoint is exempt" is declared once on the route instead of
 * restated as a pathname string per concern.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import {
  Application,
  Container,
  Controller,
  Get,
  Post,
  Middleware,
  csrfGuard,
  defineRouteFlag,
  rateLimitGuard,
  type AppModule,
  type ModuleRoutes,
  type RequestContext,
} from '../src/index'
import { fastifyRuntime } from '../src/http/runtimes/fastify'
import { h3Runtime } from '../src/http/runtimes/h3'

const CsrfExempt = defineRouteFlag('csrf.exempt')
const Public = defineRouteFlag('auth.public')

const mod = (controller: unknown): AppModule =>
  ({ routes: (): ModuleRoutes => ({ path: '/t', controller }) }) as AppModule

const boot = async (controller: unknown, runtime?: () => unknown) => {
  const app = new Application({
    modules: [mod(controller)],
    apiPrefix: '/api',
    defaultVersion: 1,
    ...(runtime ? { runtime: runtime() } : {}),
  } as never)
  await app.setup()
  return app
}

describe('csrfGuard + route flags', () => {
  beforeEach(() => Container.reset())

  // Built per test: decorators fire at class-definition time, so a class
  // declared once and reused across `Container.reset()` resolves to an
  // instance without its handlers.
  const makeController = () => {
    @Middleware(csrfGuard({ exemptWhen: 'csrf.exempt' }))
    @Controller()
    class C {
      @Get('/token')
      token(ctx: RequestContext) {
        ctx.json({ ok: true })
      }

      @Post('/pay')
      pay(ctx: RequestContext) {
        ctx.json({ paid: true })
      }

      @CsrfExempt
      @Post('/webhook/:provider')
      webhook(ctx: RequestContext) {
        ctx.json({ received: ctx.params.provider })
      }
    }
    return C
  }

  it('issues a token cookie on a safe method', async () => {
    const app = await boot(makeController())
    const res = await request(app.handle.bind(app)).get('/api/v1/t/token')
    expect(res.status).toBe(200)
    expect(String(res.headers['set-cookie'])).toContain('_csrf=')
  })

  it('issues a cookie the page can read — the double-submit flow depends on it', async () => {
    const app = await boot(makeController())
    const res = await request(app.handle.bind(app)).get('/api/v1/t/token')
    const cookie = String(res.headers['set-cookie'])
    // httpOnly would hide the token from document.cookie, so the client could
    // never echo it and every mutating request would 403.
    expect(cookie).not.toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
  })

  it('honours httpOnly: true for apps that deliver the token another way', async () => {
    @Middleware(csrfGuard({ cookieOptions: { httpOnly: true } }))
    @Controller()
    class H {
      @Get('/token')
      token(ctx: RequestContext) {
        ctx.json({ ok: true })
      }
    }
    const app = await boot(H)
    const res = await request(app.handle.bind(app)).get('/api/v1/t/token')
    expect(String(res.headers['set-cookie'])).toContain('HttpOnly')
  })

  it('rejects a mutating request with no token', async () => {
    const app = await boot(makeController())
    const res = await request(app.handle.bind(app)).post('/api/v1/t/pay').send({})
    expect({ status: res.status, message: res.body?.message }).toEqual({
      status: 403,
      message: 'CSRF token mismatch',
    })
  })

  it('accepts a mutating request whose header matches the cookie', async () => {
    const app = await boot(makeController())
    const h = app.handle.bind(app)
    const seed = await request(h).get('/api/v1/t/token')
    const cookie = String(seed.headers['set-cookie'][0])
    const token = /_csrf=([^;]+)/.exec(cookie)![1]

    const res = await request(h)
      .post('/api/v1/t/pay')
      .set('cookie', `_csrf=${token}`)
      .set('x-csrf-token', token)
      .send({})
    expect({ status: res.status, paid: res.body?.paid }).toEqual({ status: 200, paid: true })
  })

  it('skips the check on a flagged route — including one with a param', async () => {
    const app = await boot(makeController())
    const res = await request(app.handle.bind(app)).post('/api/v1/t/webhook/stripe').send({})
    // `ignorePaths` could not express this route at all: it matches on the
    // resolved pathname, and '/api/v1/t/webhook/:provider' never equals it.
    expect({ status: res.status, received: res.body?.received }).toEqual({
      status: 200,
      received: 'stripe',
    })
  })

  for (const [name, runtime] of [
    ['fastify', fastifyRuntime],
    ['h3', h3Runtime],
  ] as const) {
    it(`honours the flag under ${name} too`, async () => {
      const app = await boot(makeController(), runtime as () => unknown)
      const h = app.handle.bind(app)
      const exempt = await request(h).post('/api/v1/t/webhook/paypal').send({})
      const guarded = await request(h).post('/api/v1/t/pay').send({})
      expect({ rt: name, exempt: exempt.status, guarded: guarded.status }).toEqual({
        rt: name,
        exempt: 200,
        guarded: 403,
      })
    })
  }
})

describe('rateLimitGuard + route flags', () => {
  beforeEach(() => Container.reset())

  const makeController = () => {
    @Middleware(rateLimitGuard({ max: 1, windowMs: 60_000, exemptWhen: 'auth.public' }))
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
    }
    return C
  }

  it('limits an unflagged route', async () => {
    const app = await boot(makeController())
    const h = app.handle.bind(app)
    const first = await request(h).get('/api/v1/t/limited')
    const second = await request(h).get('/api/v1/t/limited')
    expect({ first: first.status, second: second.status }).toEqual({ first: 200, second: 429 })
  })

  it('leaves a flagged route alone past the limit', async () => {
    const app = await boot(makeController())
    const h = app.handle.bind(app)
    const statuses: number[] = []
    for (let i = 0; i < 4; i++) statuses.push((await request(h).get('/api/v1/t/health')).status)
    expect(statuses).toEqual([200, 200, 200, 200])
  })

  it('a list exempts any of several flags', async () => {
    @Middleware(rateLimitGuard({ max: 1, exemptWhen: ['auth.public', 'csrf.exempt'] }))
    @Controller()
    class L {
      @CsrfExempt
      @Get('/a')
      a(ctx: RequestContext) {
        ctx.json({ ok: true })
      }
    }
    const app = await boot(L)
    const h = app.handle.bind(app)
    const statuses = [
      (await request(h).get('/api/v1/t/a')).status,
      (await request(h).get('/api/v1/t/a')).status,
    ]
    expect(statuses).toEqual([200, 200])
  })

  it('a predicate can exempt on the flag value', async () => {
    const Limit = defineRouteFlag<{ rpm: number }>('rate.limit')

    @Middleware(
      rateLimitGuard({
        max: 1,
        exemptWhen: ({ flags }) =>
          (flags.get('rate.limit') as { rpm: number } | undefined)?.rpm === 0,
      }),
    )
    @Controller()
    class P {
      @Limit({ rpm: 0 })
      @Get('/unmetered')
      unmetered(ctx: RequestContext) {
        ctx.json({ ok: true })
      }

      @Limit({ rpm: 5 })
      @Get('/metered')
      metered(ctx: RequestContext) {
        ctx.json({ ok: true })
      }
    }

    const app = await boot(P)
    const h = app.handle.bind(app)
    const unmetered = [
      (await request(h).get('/api/v1/t/unmetered')).status,
      (await request(h).get('/api/v1/t/unmetered')).status,
    ]
    const metered = [
      (await request(h).get('/api/v1/t/metered')).status,
      (await request(h).get('/api/v1/t/metered')).status,
    ]
    expect({ unmetered, metered }).toEqual({ unmetered: [200, 200], metered: [200, 429] })
  })
})
