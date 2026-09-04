/**
 * Module-level route flags — the third registration site.
 *
 * A decorator can only flag a controller you own. A module mounts controllers
 * it may not own (the framework's own health controller is the case that forced
 * this), so the flags belong on the mount.
 *
 * The load-bearing cases: mount flags reach a controller carrying no flag
 * decorator at all, a method still wins over them, `@Flag.off` still removes
 * them, and `getRouteFlags()` — which sees no mount — reports the same answer
 * the runtime resolved, so Swagger and DevTools cannot drift from it.
 */
import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import {
  Application,
  Container,
  Controller,
  Get,
  HttpException,
  defineHttpContextDecorator,
  defineRouteFlag,
  getRouteFlags,
  type AppModule,
  type ModuleRoutes,
  type RequestContext,
} from '../src/index'

const Public = defineRouteFlag('ops.public')
const Limit = defineRouteFlag<{ rpm: number }>('ops.limit')

@Controller()
class PlainController {
  @Get('/open')
  open(ctx: RequestContext) {
    ctx.json({ flags: [...(ctx.route?.flags.keys() ?? [])] })
  }

  @Public.off
  @Get('/closed')
  closed(ctx: RequestContext) {
    ctx.json({ flags: [...(ctx.route?.flags.keys() ?? [])] })
  }
}

@Controller()
@Limit({ rpm: 1 })
class DecoratedController {
  @Get('/')
  index(ctx: RequestContext) {
    ctx.json({ limit: ctx.route?.flags.get('ops.limit') })
  }
}

const mod = (path: string, controller: unknown, flags?: ModuleRoutes['flags']): AppModule =>
  ({ routes: (): ModuleRoutes => ({ path, controller, flags }) }) as AppModule

const boot = async (modules: AppModule[]) => {
  const app = new Application({ modules, apiPrefix: '/api', defaultVersion: 1 } as never)
  await app.setup()
  return app.getExpressApp()
}

beforeEach(() => {
  Container.reset()
})

describe('ModuleRoutes.flags', () => {
  it('applies to every route the mount produces', async () => {
    const http = await boot([mod('/x', PlainController, ['ops.public'])])
    const res = await request(http).get('/api/v1/x/open').expect(200)
    expect(res.body.flags).toEqual(['ops.public'])
  })

  it('is removable per method with @Flag.off', async () => {
    const http = await boot([mod('/x', PlainController, ['ops.public'])])
    const res = await request(http).get('/api/v1/x/closed').expect(200)
    expect(res.body.flags).toEqual([])
  })

  it('loses to a class declaration of the same flag', async () => {
    const http = await boot([mod('/y', DecoratedController, { 'ops.limit': { rpm: 99 } })])
    const res = await request(http).get('/api/v1/y').expect(200)
    expect(res.body.limit).toEqual({ rpm: 1 })
  })

  it('accepts values through the record form', async () => {
    const http = await boot([mod('/y', PlainController, { 'ops.limit': { rpm: 5 } })])
    const res = await request(http).get('/api/v1/y/open').expect(200)
    expect(res.body.flags).toEqual(['ops.limit'])
  })

  it('is visible to getRouteFlags, so out-of-request readers agree', async () => {
    await boot([mod('/x', PlainController, ['ops.public'])])
    expect(getRouteFlags(PlainController, 'open').has('ops.public')).toBe(true)
    // The method-level `.off` must win here too — a spec that marked
    // /x/closed public while the runtime protected it is the failure mode.
    expect(getRouteFlags(PlainController, 'closed').has('ops.public')).toBe(false)
  })

  it('rejects a negated name at boot rather than never matching', async () => {
    await expect(boot([mod('/x', PlainController, ['!ops.public'] as never)])).rejects.toThrow(
      /cannot start with '!'/,
    )
  })
})

describe('health: { flags }', () => {
  // The reason the mount site exists: HealthController is the framework's, the
  // flag name is the app's, and no decorator can bridge that.
  //
  // Registered app-wide as a contributor rather than as a global middleware:
  // global middleware runs before a route is matched and has no `ctx.route`,
  // so it is structurally unable to read flags. A contributor runs in-route.
  const RequireAuth = defineHttpContextDecorator({
    key: 'user',
    skipWhen: 'ops.public',
    resolve: (ctx: RequestContext) => {
      if (!ctx.headers.authorization) throw new HttpException(401, 'Unauthorized')
      return { id: 'u1' }
    },
  })

  const bootApp = async (health?: unknown) => {
    const app = new Application({
      modules: [],
      contributors: [RequireAuth.registration],
      ...(health === undefined ? {} : { health }),
    } as never)
    await app.setup()
    return app.getExpressApp()
  }

  it('leaves the probes guarded by default', async () => {
    await request(await bootApp())
      .get('/health/live')
      .expect(401)
  })

  it('exempts both probes once the app names its flag', async () => {
    const http = await bootApp({ flags: ['ops.public'] })
    await request(http).get('/health/live').expect(200)
    await request(http).get('/health/ready').expect(200)
  })

  it('still honours health: false', async () => {
    await request(await bootApp(false))
      .get('/health/live')
      .expect(404)
  })
})
