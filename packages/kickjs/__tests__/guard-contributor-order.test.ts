/**
 * Where a `@Middleware()` guard sits relative to the contributor pipeline.
 *
 * The docs claimed contributors ran first, so a guard could read `ctx.get('user')`.
 * They don't: the route entry runs validation → upload → class middleware →
 * method middleware → contributorRunner → handler. A guard that reads a
 * contributor's value therefore sees `undefined`, and a role check written that
 * way fails open or throws depending on how it handles the missing value.
 *
 * Asserted on all three runtimes because the ordering lives in each runtime's
 * materializer, not in one shared place.
 */
import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import {
  Application,
  Container,
  Controller,
  Get,
  Middleware,
  defineHttpContextDecorator,
  type AppModule,
  type ModuleRoutes,
  type RequestContext,
} from '../src/index'
import { fastifyRuntime } from '../src/http/runtimes/fastify'
import { h3Runtime } from '../src/http/runtimes/h3'

declare module '../src/index' {
  interface ContextMeta {
    orderUser: { id: string }
  }
}

const trace: string[] = []

const LoadUser = defineHttpContextDecorator({
  key: 'orderUser',
  resolve: () => {
    trace.push('contributor')
    return { id: 'u1' }
  },
})

const guard = (ctx: RequestContext, next: () => void) => {
  trace.push(ctx.get('orderUser') ? 'guard:sees-user' : 'guard:no-user')
  next()
}

@LoadUser
@Middleware(guard)
@Controller()
class OrderController {
  @Get('/probe')
  probe(ctx: RequestContext) {
    trace.push('handler')
    ctx.json({ user: ctx.get('orderUser') ?? null })
  }
}

const mod = (): AppModule =>
  ({ routes: (): ModuleRoutes => ({ path: '/order', controller: OrderController }) }) as AppModule

beforeEach(() => {
  Container.reset()
  trace.length = 0
})

describe('guard vs contributor ordering', () => {
  const runtimes = [
    ['express', undefined],
    ['fastify', fastifyRuntime],
    ['h3', h3Runtime],
  ] as const

  for (const [name, runtime] of runtimes) {
    it(`runs @Middleware() before contributors on ${name}`, async () => {
      const app = new Application({
        modules: [mod()],
        apiPrefix: '/api',
        defaultVersion: 1,
        ...(runtime ? { runtime: runtime() } : {}),
      } as never)
      await app.setup()

      const res = await request(app.handle.bind(app)).get('/api/v1/order/probe')

      expect(trace).toEqual(['guard:no-user', 'contributor', 'handler'])
      // The handler still gets the value — only the guard is too early for it.
      expect(res.body.user).toEqual({ id: 'u1' })
    })
  }
})
