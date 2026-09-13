/**
 * `beforeValidation` contributors (#677).
 *
 * Validation runs ahead of the contributor pipeline, so with auth as a
 * contributor a request with no credentials and a malformed body answered 422
 * instead of 401 — telling an anonymous caller what the schema expects. A
 * contributor marked `beforeValidation` runs before validation and middleware.
 *
 * The step sequence is implemented separately in each runtime, so every case
 * runs on all of them.
 */
import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { z } from 'zod'
import * as h3v2 from 'h3-v2'
import {
  Application,
  Container,
  Controller,
  HttpException,
  Middleware,
  Post,
  defineHttpContextDecorator,
  type AppModule,
  type ModuleRoutes,
  type RequestContext,
} from '../src/index'
import { fastifyRuntime } from '../src/http/runtimes/fastify'
import { h3Runtime } from '../src/http/runtimes/h3'
import { h3WebRuntime } from '../src/http/runtimes/h3-web'
import { requestStore } from '../src/http/request-store'
import { buildPipeline, splitBeforeValidation } from '../src/core/contributor-pipeline'
import type { RouteEntry } from '../src/http/runtime'

declare module '../src/index' {
  interface ContextMeta {
    bvUser: { id: string }
    bvTenant: string
  }
}

const seen: { bodyAtAuth?: unknown; guardUser?: unknown } = {}

const authenticate = (ctx: RequestContext) => {
  if (ctx.headers.authorization !== 'Bearer ok') throw HttpException.unauthorized()
  seen.bodyAtAuth = ctx.body
  return { id: 'u1' }
}

const EarlyAuth = defineHttpContextDecorator({
  key: 'bvUser',
  beforeValidation: true,
  resolve: authenticate,
})
const LateAuth = defineHttpContextDecorator({ key: 'bvUser', resolve: authenticate })

const body = z.object({ name: z.string() })

@Controller()
class EarlyController {
  @EarlyAuth
  @Middleware((ctx: RequestContext, next: () => void) => {
    seen.guardUser = ctx.get('bvUser')
    next()
  })
  @Post('/', { body })
  create(ctx: RequestContext) {
    return { body: ctx.body }
  }
}

@Controller()
class LateController {
  @LateAuth
  @Post('/', { body })
  create(ctx: RequestContext) {
    return { body: ctx.body }
  }
}
void EarlyController
void LateController

const mod = (): AppModule =>
  ({
    routes: (): ModuleRoutes[] => [
      { path: '/early', controller: EarlyController },
      { path: '/late', controller: LateController },
    ],
  }) as AppModule

beforeEach(() => {
  Container.reset()
  delete seen.bodyAtAuth
  delete seen.guardUser
})

const runtimes = [
  ['express', undefined],
  ['fastify', fastifyRuntime],
  ['h3', h3Runtime],
] as const

describe.each(runtimes)('beforeValidation contributors on %s', (_, runtime) => {
  async function server() {
    const app = new Application({
      modules: [mod()],
      apiPrefix: '/api',
      defaultVersion: 1,
      ...(runtime ? { runtime: runtime() } : {}),
    } as never)
    await app.setup()
    return request(app.handle.bind(app))
  }

  it('answers 401 before validation when credentials are missing', async () => {
    const res = await (await server()).post('/api/v1/early').send({})
    expect(res.status).toBe(401)
  })

  it('keeps the default order for contributors without it (422 first)', async () => {
    const res = await (await server()).post('/api/v1/late').send({})
    expect(res.status).toBe(422)
  })

  it('still validates once the contributor passes', async () => {
    const agent = await server()
    const res = await agent.post('/api/v1/early').set('authorization', 'Bearer ok').send({})
    expect(res.status).toBe(422)
  })

  it('sees the unvalidated body, and middleware sees the contributor value', async () => {
    const agent = await server()
    const res = await agent
      .post('/api/v1/early')
      .set('authorization', 'Bearer ok')
      .send({ name: 'a', extra: true })
    expect(res.status).toBe(200)
    // Validation strips `extra`; the contributor ran before it did.
    expect(seen.bodyAtAuth).toEqual({ name: 'a', extra: true })
    expect(res.body.body).toEqual({ name: 'a' })
    expect(seen.guardUser).toEqual({ id: 'u1' })
  })
})

describe('beforeValidation contributors on the web entry (h3-web)', () => {
  function app(early: boolean) {
    Container._requestStoreProvider = () => requestStore.getStore() ?? null
    const entry: RouteEntry = {
      method: 'POST',
      path: '/x',
      middlewares: [],
      contributorRunner: null,
      earlyContributorRunner: early
        ? async () => {
            throw HttpException.unauthorized()
          }
        : null,
      handler: async (ctx: RequestContext) => ctx.json({ ok: true }),
      meta: { validation: { body } },
    }
    const runtime = h3WebRuntime({ h3: h3v2 })
    const instance = runtime.createApp()
    runtime.mountRoutes(instance, [{ mountPath: '/api', routes: [entry] }])
    runtime.nodeHandler(instance)
    return instance
  }
  const post = () =>
    new Request('http://test/api/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })

  it('answers 401 before validation', async () => {
    expect((await app(true).fetch(post())).status).toBe(401)
  })

  it('validates first without it', async () => {
    expect((await app(false).fetch(post())).status).toBe(422)
  })
})

describe('splitBeforeValidation', () => {
  const Tenant = defineHttpContextDecorator({ key: 'bvTenant', resolve: () => 't1' })

  it('fails boot when an early contributor depends on a late one', () => {
    const EarlyNeedsTenant = defineHttpContextDecorator({
      key: 'bvUser',
      beforeValidation: true,
      dependsOn: ['bvTenant'],
      resolve: () => ({ id: 'u1' }),
    })
    const pipeline = buildPipeline([
      { source: 'method', registration: Tenant.registration },
      { source: 'method', registration: EarlyNeedsTenant.registration },
    ])
    expect(() => splitBeforeValidation(pipeline, 'POST /x')).toThrow(
      "Contributor 'bvUser' on POST /x sets beforeValidation but depends on 'bvTenant'",
    )
  })

  it('lets a late contributor depend on an early one, keeping topo order', () => {
    const User = defineHttpContextDecorator({
      key: 'bvUser',
      beforeValidation: true,
      resolve: () => ({ id: 'u1' }),
    })
    const TenantOfUser = defineHttpContextDecorator({
      key: 'bvTenant',
      dependsOn: ['bvUser'],
      resolve: () => 't1',
    })
    const { early, late } = splitBeforeValidation(
      buildPipeline([
        { source: 'method', registration: TenantOfUser.registration },
        { source: 'method', registration: User.registration },
      ]),
    )
    expect(early?.contributors.map((r) => r.key)).toEqual(['bvUser'])
    expect(late?.contributors.map((r) => r.key)).toEqual(['bvTenant'])
  })
})
