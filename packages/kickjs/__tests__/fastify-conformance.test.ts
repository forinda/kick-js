import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import {
  Application,
  Container,
  Controller,
  Get,
  RequestContext,
  defineContextDecorator,
  expressRuntime,
  type HttpRuntime,
} from '../src/index'
import { fastifyRuntime } from '../src/http/runtimes/fastify'

// One fixture app, run under both runtimes — the conformance harness. Proves the
// HttpRuntime contract holds for Fastify: native routing, the RuntimeResponse
// driver (ctx.json / ctx.html), and connect middleware via @fastify/middie.
const RUNTIMES: Array<{ name: string; make: () => HttpRuntime }> = [
  { name: 'express', make: () => expressRuntime() },
  { name: 'fastify', make: () => fastifyRuntime() },
]

beforeEach(() => {
  Container.reset()
})

for (const rt of RUNTIMES) {
  describe(`runtime conformance — ${rt.name}`, () => {
    it('routes a GET and serves JSON through the response driver', async () => {
      @Controller()
      class PingController {
        @Get('/ping/:name')
        ping(ctx: RequestContext) {
          ctx.json({ pong: ctx.params.name })
        }
      }

      const app = new Application({
        // runtime option is HttpRuntime<Express> until it widens with the driver
        // layer; the fastify runtime is sound here (cast at the call site).
        runtime: rt.make() as never,
        apiPrefix: '/api',
        defaultVersion: 1,
        modules: [{ routes: () => ({ path: '/p', controller: PingController }) } as never],
      })
      await app.setup()

      const res = await request(app.handle.bind(app)).get('/api/v1/p/ping/ada').expect(200)
      expect(res.body).toEqual({ pong: 'ada' })
    })

    it('serves HTML through the response driver', async () => {
      @Controller()
      class HtmlController {
        @Get('/page')
        page(ctx: RequestContext) {
          ctx.html('<h1>hi</h1>')
        }
      }
      const app = new Application({
        runtime: rt.make() as never,
        modules: [{ routes: () => ({ path: '/h', controller: HtmlController }) } as never],
      })
      await app.setup()

      const res = await request(app.handle.bind(app)).get('/api/v1/h/page').expect(200)
      expect(res.text).toContain('<h1>hi</h1>')
      expect(res.headers['content-type']).toMatch(/html/)
    })

    it('runs a global connect middleware', async () => {
      @Controller()
      class C {
        @Get('/m')
        m(ctx: RequestContext) {
          ctx.json({ ok: true })
        }
      }
      const app = new Application({
        runtime: rt.make() as never,
        middlewares: [
          (_req: never, res: { setHeader: (n: string, v: string) => void }, next: () => void) => {
            res.setHeader('x-conformance', rt.name)
            next()
          },
        ],
        modules: [{ routes: () => ({ path: '/mw', controller: C }) } as never],
      })
      await app.setup()

      const res = await request(app.handle.bind(app)).get('/api/v1/mw/m').expect(200)
      expect(res.headers['x-conformance']).toBe(rt.name)
    })

    it('runs a context contributor and exposes it via ctx.get (ALS frame)', async () => {
      const LoadWho = defineContextDecorator({ key: 'who', resolve: () => 'ada' })

      @Controller()
      class C {
        @LoadWho
        @Get('/who')
        who(ctx: RequestContext) {
          ctx.json({ who: ctx.get('who') })
        }
      }
      const app = new Application({
        runtime: rt.make() as never,
        apiPrefix: '/api',
        defaultVersion: 1,
        modules: [{ routes: () => ({ path: '/c', controller: C }) } as never],
      })
      await app.setup()

      const res = await request(app.handle.bind(app)).get('/api/v1/c/who').expect(200)
      expect(res.body).toEqual({ who: 'ada' })
    })
  })
}
