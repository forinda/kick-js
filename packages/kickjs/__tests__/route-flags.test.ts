/**
 * Route flags (spec: `route-flags-design.md`).
 *
 * The load-bearing case is the last group: a class-level `@Public` with a
 * method-level `@Public.off` must resolve with the flag ABSENT on that
 * method, not present-and-false. Both directions are asserted, because a
 * resolver that dropped the key everywhere would pass a one-sided test.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import {
  Application,
  Container,
  Controller,
  Get,
  HttpException,
  Middleware,
  defineHttpContextDecorator,
  defineRouteFlag,
  buildRoutes,
  type AppModule,
  type ModuleRoutes,
  type RequestContext,
} from '../src/index'
import { buildRouteTable } from '../src/http/router-builder'
import { fastifyRuntime } from '../src/http/runtimes/fastify'
import { h3Runtime } from '../src/http/runtimes/h3'

declare module '../src/index' {
  interface ContextMeta {
    user: { id: string } | null
  }
}

const Public = defineRouteFlag('auth.public')
const RateLimit = defineRouteFlag<{ rpm: number }>('rate.limit')

const mod = (path: string, controller: unknown): AppModule =>
  ({ routes: (): ModuleRoutes => ({ path, controller }) }) as AppModule

const boot = async (controllers: [string, unknown][], runtime?: () => unknown) => {
  const app = new Application({
    modules: controllers.map(([p, c]) => mod(p, c)),
    apiPrefix: '/api',
    defaultVersion: 1,
    ...(runtime ? { runtime: runtime() } : {}),
  } as never)
  await app.setup()
  return app
}

const bootWith = async (options: Record<string, unknown>) => {
  const app = new Application({ apiPrefix: '/api', defaultVersion: 1, ...options } as never)
  await app.setup()
  return app
}

describe('route flags — resolution', () => {
  beforeEach(() => Container.reset())

  it('a class-level flag lands on every route of the controller', () => {
    @Public
    @Controller()
    class C {
      @Get('/a') a(_ctx: RequestContext) {}
      @Get('/b') b(_ctx: RequestContext) {}
    }

    const table = buildRouteTable(C)
    expect(table.map((e) => e.meta.flags?.get('auth.public'))).toEqual([true, true])
  })

  it('a method-level flag applies to that route only', () => {
    @Controller()
    class C {
      @Public
      @Get('/open')
      open(_ctx: RequestContext) {}
      @Get('/closed') closed(_ctx: RequestContext) {}
    }

    const table = buildRouteTable(C)
    const byPath = Object.fromEntries(table.map((e) => [e.path, e.meta.flags?.has('auth.public')]))
    expect(byPath).toEqual({ '/open': true, '/closed': false })
  })

  it('carries a value, not just presence', () => {
    @Controller()
    class C {
      @RateLimit({ rpm: 10 })
      @Get('/limited')
      limited(_ctx: RequestContext) {}
    }

    expect(buildRouteTable(C)[0].meta.flags?.get('rate.limit')).toEqual({ rpm: 10 })
  })

  it('a false flag resolves ABSENT, not present-and-false', () => {
    @Public
    @Controller()
    class C {
      @Get('/inherits') inherits(_ctx: RequestContext) {}

      @Public.off
      @Get('/overrides')
      overrides(_ctx: RequestContext) {}
    }

    const table = buildRouteTable(C)
    const flags = Object.fromEntries(table.map((e) => [e.path, e.meta.flags!]))

    // Both directions: the sibling still carries it, the override does not.
    expect(flags['/inherits'].has('auth.public')).toBe(true)
    expect(flags['/overrides'].has('auth.public')).toBe(false)
    // …and specifically not stored as `false`, which `has()` would report true.
    expect(flags['/overrides'].get('auth.public')).toBeUndefined()
  })
})

describe('route flags — reserved names', () => {
  it("rejects a flag name starting with '!'", () => {
    // '!x' as a NAME would be indistinguishable from the negation of 'x', so a
    // test written as `exemptWhen: '!x'` would silently change meaning.
    expect(() => defineRouteFlag('!csrf.exempt' as never)).toThrow(/cannot start with '!'/)
  })

  it('still accepts a name containing ! elsewhere', () => {
    expect(() => defineRouteFlag('urgent!' as never)).not.toThrow()
  })
})

describe('route flags — ctx.route', () => {
  beforeEach(() => Container.reset())

  it('exposes the matched route to the handler', async () => {
    @Public
    @Controller()
    class C {
      @Get('/:id')
      show(ctx: RequestContext) {
        ctx.json({
          method: ctx.route?.method,
          path: ctx.route?.path,
          handler: ctx.route?.handlerName,
          isPublic: ctx.route?.flags.has('auth.public'),
        })
      }
    }

    const app = await boot([['/things', C]])
    const res = await request(app.handle.bind(app)).get('/api/v1/things/7')
    expect(res.body).toEqual({
      method: 'GET',
      path: '/:id',
      handler: 'show',
      isPublic: true,
    })
  })

  it('route middleware sees flags before the handler runs', async () => {
    const seen: (boolean | undefined)[] = []
    const spy = (ctx: RequestContext, next: () => void) => {
      seen.push(ctx.route?.flags.has('auth.public'))
      next()
    }

    @Public
    @Controller()
    class C {
      @Middleware(spy)
      @Get('/x')
      x(ctx: RequestContext) {
        ctx.json({ ok: true })
      }
    }

    const app = await boot([['/m', C]])
    await request(app.handle.bind(app)).get('/api/v1/m/x')
    expect(seen).toEqual([true])
  })

  for (const [name, runtime] of [
    ['fastify', fastifyRuntime],
    ['h3', h3Runtime],
  ] as const) {
    it(`works under ${name} without runtime-specific wiring`, async () => {
      @Public
      @Controller()
      class C {
        @Get('/x')
        x(ctx: RequestContext) {
          ctx.json({ isPublic: ctx.route?.flags.has('auth.public') })
        }
      }

      const app = await boot([['/r', C]], runtime as () => unknown)
      const res = await request(app.handle.bind(app)).get('/api/v1/r/x')
      expect({ rt: name, body: res.body }).toEqual({ rt: name, body: { isPublic: true } })
    })
  }
})

describe('route flags — contributor skipWhen', () => {
  beforeEach(() => Container.reset())

  const LoadAuthUser = defineHttpContextDecorator({
    key: 'user',
    skipWhen: 'auth.public',
    resolve: (ctx: RequestContext) => {
      const token = ctx.headers.authorization
      if (!token) throw new HttpException(401, 'Unauthorized')
      return { id: 'u1' }
    },
  })

  @Controller()
  class PrivateController {
    @Get('/secret')
    secret(ctx: RequestContext) {
      ctx.json({ user: ctx.get('user') ?? null })
    }
  }

  @Public
  @Controller()
  class OpenController {
    @Get('/a')
    a(ctx: RequestContext) {
      ctx.json({ user: ctx.get('user') ?? null })
    }

    @Public.off
    @Get('/admin')
    admin(ctx: RequestContext) {
      ctx.json({ user: ctx.get('user') ?? null })
    }
  }

  const bootWithGlobalAuth = async () =>
    bootWith({
      modules: [mod('/p', PrivateController), mod('/o', OpenController)],
      contributors: [LoadAuthUser.registration],
    })

  it('runs the contributor on an unflagged route', async () => {
    const app = await bootWithGlobalAuth()
    const res = await request(app.handle.bind(app)).get('/api/v1/p/secret')
    expect(res.status).toBe(401)
  })

  it('skips it on a route flagged by its controller', async () => {
    const app = await bootWithGlobalAuth()
    const res = await request(app.handle.bind(app)).get('/api/v1/o/a')
    expect({ status: res.status, user: res.body?.user }).toEqual({ status: 200, user: null })
  })

  it('runs again where the method turned the flag off', async () => {
    const app = await bootWithGlobalAuth()
    const res = await request(app.handle.bind(app)).get('/api/v1/o/admin')
    expect(res.status).toBe(401)
  })

  it('still resolves the user when authenticated', async () => {
    const app = await bootWithGlobalAuth()
    const res = await request(app.handle.bind(app))
      .get('/api/v1/p/secret')
      .set('authorization', 'Bearer t')
    expect({ status: res.status, user: res.body?.user }).toEqual({
      status: 200,
      user: { id: 'u1' },
    })
  })

  it('onlyWhen is the inverse — runs solely on flagged routes', async () => {
    const calls: string[] = []
    const Metered = defineRouteFlag('billing.metered')
    const CountUsage = defineHttpContextDecorator({
      key: 'user',
      onlyWhen: 'billing.metered',
      resolve: (ctx: RequestContext) => {
        calls.push(ctx.route?.path ?? '?')
        return null
      },
    })

    @Controller()
    class C {
      @Metered
      @Get('/metered')
      metered(ctx: RequestContext) {
        ctx.json({ ok: true })
      }
      @Get('/free')
      free(ctx: RequestContext) {
        ctx.json({ ok: true })
      }
    }

    const app = await bootWith({
      modules: [mod('/b', C)],
      contributors: [CountUsage.registration],
    })
    const h = app.handle.bind(app)
    await request(h).get('/api/v1/b/metered')
    await request(h).get('/api/v1/b/free')
    expect(calls).toEqual(['/metered'])
  })
})

describe('route flags — multiple flag checks', () => {
  beforeEach(() => Container.reset())

  const Probe = defineRouteFlag('health.probe')

  const runsFor = async (skipWhen: unknown) => {
    const ran: string[] = []
    const Track = defineHttpContextDecorator({
      key: 'user',
      skipWhen: skipWhen as never,
      resolve: (ctx: RequestContext) => {
        ran.push(ctx.route?.path ?? '?')
        return null
      },
    })

    @Controller()
    class C {
      @Public
      @Get('/public')
      pub(ctx: RequestContext) {
        ctx.json({})
      }

      @Probe
      @Get('/probe')
      probe(ctx: RequestContext) {
        ctx.json({})
      }

      @Public
      @Probe
      @Get('/both')
      both(ctx: RequestContext) {
        ctx.json({})
      }

      @Get('/plain')
      plain(ctx: RequestContext) {
        ctx.json({})
      }
    }

    const app = await bootWith({ modules: [mod('/f', C)], contributors: [Track.registration] })
    const h = app.handle.bind(app)
    for (const p of ['/public', '/probe', '/both', '/plain']) await request(h).get(`/api/v1/f${p}`)
    return ran
  }

  it('a list of flags matches any of them', async () => {
    expect(await runsFor(['auth.public', 'health.probe'])).toEqual(['/plain'])
  })

  it('a single flag leaves the others alone', async () => {
    expect(await runsFor('auth.public')).toEqual(['/probe', '/plain'])
  })

  it('a predicate expresses all-of, which a list deliberately cannot', async () => {
    const ran = await runsFor(
      ({ flags }: { flags: ReadonlyMap<string, unknown> }) =>
        flags.has('auth.public') && flags.has('health.probe'),
    )
    expect(ran).toEqual(['/public', '/probe', '/plain'])
  })

  it('a predicate can read a flag value, not just its presence', async () => {
    const ran = await runsFor(
      ({ flags }: { flags: ReadonlyMap<string, unknown> }) =>
        (flags.get('rate.limit') as { rpm: number } | undefined)?.rpm === 0,
    )
    // No route declares rate.limit: 0, so nothing is skipped.
    expect(ran).toEqual(['/public', '/probe', '/both', '/plain'])
  })

  it('a predicate can route on the matched path', async () => {
    const ran = await runsFor(({ route }: { route?: { path: string } }) => route?.path === '/plain')
    expect(ran).toEqual(['/public', '/probe', '/both'])
  })
})

describe('route flags — buildRoutes parity', () => {
  beforeEach(() => Container.reset())

  it('a hand-built router still gets flags via buildRoutes', () => {
    @Public
    @Controller()
    class C {
      @Get('/x') x(_ctx: RequestContext) {}
    }
    // buildRoutes wraps buildRouteTable; the flag must survive that path too.
    expect(() => buildRoutes(C)).not.toThrow()
    expect(buildRouteTable(C)[0].meta.flags?.has('auth.public')).toBe(true)
  })
})

describe('route flags — negated tests', () => {
  beforeEach(() => Container.reset())

  const Metered = defineRouteFlag('billing.metered')

  const runsFor = async (skipWhen: unknown) => {
    const ran: string[] = []
    const Track = defineHttpContextDecorator({
      key: 'user',
      skipWhen: skipWhen as never,
      resolve: (ctx: RequestContext) => {
        ran.push(ctx.route?.path ?? '?')
        return null
      },
    })

    @Controller()
    class C {
      @Public
      @Get('/pub')
      pub(ctx: RequestContext) {
        ctx.json({})
      }

      @Metered
      @Get('/metered')
      metered(ctx: RequestContext) {
        ctx.json({})
      }

      @Public
      @Metered
      @Get('/both')
      both(ctx: RequestContext) {
        ctx.json({})
      }

      @Get('/plain')
      plain(ctx: RequestContext) {
        ctx.json({})
      }
    }

    const app = await bootWith({ modules: [mod('/n', C)], contributors: [Track.registration] })
    const h = app.handle.bind(app)
    for (const p of ['/pub', '/metered', '/both', '/plain']) await request(h).get(`/api/v1/n${p}`)
    return ran
  }

  it("'!flag' skips the routes that do NOT carry it", async () => {
    // Skip where auth.public is absent → only the flagged routes run.
    expect(await runsFor('!auth.public')).toEqual(['/pub', '/both'])
  })

  it('a negated list means "carries none of these"', async () => {
    // Skip only where BOTH are absent → /plain is the only one skipped.
    expect(await runsFor(['!auth.public', '!billing.metered'])).toEqual([
      '/pub',
      '/metered',
      '/both',
    ])
  })

  it('a positive list still means "carries any of these"', async () => {
    expect(await runsFor(['auth.public', 'billing.metered'])).toEqual(['/plain'])
  })

  it('throws on a mixed-polarity list rather than guessing', async () => {
    await expect(runsFor(['auth.public', '!billing.metered'])).rejects.toThrow(/mixes polarities/)
  })
})

describe('route flags — false is a value, not a sentinel', () => {
  beforeEach(() => Container.reset())

  const Enabled = defineRouteFlag<boolean>('feature.enabled')

  it('stores `false` as a value rather than deleting the flag', () => {
    @Controller()
    class C {
      @Enabled(false)
      @Get('/off')
      off(_ctx: RequestContext) {}

      @Enabled(true)
      @Get('/on')
      on(_ctx: RequestContext) {}
    }

    const byPath = Object.fromEntries(buildRouteTable(C).map((e) => [e.path, e.meta.flags!]))
    // Present AND false — the old `false`-as-removal made this unreachable.
    expect(byPath['/off'].has('feature.enabled')).toBe(true)
    expect(byPath['/off'].get('feature.enabled')).toBe(false)
    expect(byPath['/on'].get('feature.enabled')).toBe(true)
  })

  it('a symbol-valued flag can hold any symbol, including a lookalike sentinel', () => {
    const Marker = defineRouteFlag<symbol>('marker')
    // A registry-global sentinel would be reachable here and would delete the
    // flag instead of storing this value.
    const lookalike = Symbol.for('kick.flagUnset')

    @Controller()
    class C {
      @Marker(lookalike)
      @Get('/x')
      x(_ctx: RequestContext) {}
    }

    const flags = buildRouteTable(C)[0].meta.flags!
    expect(flags.has('marker')).toBe(true)
    expect(flags.get('marker')).toBe(lookalike)
  })

  it('`.off` is what removes an inherited flag', () => {
    @Enabled(true)
    @Controller()
    class C {
      @Get('/keeps') keeps(_ctx: RequestContext) {}

      @Enabled.off
      @Get('/drops')
      drops(_ctx: RequestContext) {}
    }

    const byPath = Object.fromEntries(buildRouteTable(C).map((e) => [e.path, e.meta.flags!]))
    expect(byPath['/keeps'].get('feature.enabled')).toBe(true)
    expect(byPath['/drops'].has('feature.enabled')).toBe(false)
  })
})
