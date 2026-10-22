/**
 * `share` runs inside the request: it can read and write the RequestContext
 * and resolve REQUEST-scoped services on every path that renders a page — a
 * route, an Inertia visit, an unknown URL, a handler that throws and a body
 * that doesn't parse.
 */
import 'reflect-metadata'
import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { fastifyRuntime } from '@forinda/kickjs/fastify'
import { h3Runtime } from '@forinda/kickjs/h3'
import {
  Application,
  Container,
  Controller,
  Get,
  Post,
  Scope,
  createToken,
  expressRuntime,
  type RequestContext,
} from '@forinda/kickjs'
import {
  InertiaAdapter,
  inertia,
  inertiaErrorHandler,
  inertiaNotFound,
} from '@forinda/kickjs-inertia'

const VIEWER = createToken<{ id: number }>('test/viewer')

const RUNTIMES = [
  { name: 'express', make: () => expressRuntime() },
  { name: 'fastify', make: () => fastifyRuntime() },
  { name: 'h3', make: () => h3Runtime() },
] as const

async function makeApp(rt: (typeof RUNTIMES)[number], contextStore: 'auto' | 'manual' = 'auto') {
  @Controller()
  class PagesController {
    @Get('/dashboard')
    dashboard(ctx: RequestContext) {
      ctx.set('fromHandler', 'yes')
      return inertia('Dashboard')
    }

    @Get('/broken')
    broken(ctx: RequestContext) {
      ctx.set('fromHandler', 'yes')
      ctx.set('handlerViewer', Container.getInstance().resolve(VIEWER))
      throw new Error('boom')
    }

    @Post('/save')
    save() {
      return inertia('Saved')
    }
  }

  let viewers = 0
  Container.getInstance().registerFactory(VIEWER, () => ({ id: ++viewers }), Scope.REQUEST)

  const app = new Application({
    runtime: rt.make() as never,
    contextStore,
    // Express needs a body parser; Fastify and h3 parse bodies natively.
    middlewares: rt.name === 'express' ? [express.json()] : [],
    modules: [
      class {
        routes() {
          return { path: '/', prefix: false, version: false, controller: PagesController }
        }
      } as never,
    ],
    adapters: [
      InertiaAdapter({
        version: 'v1',
        errorPage: 'Error',
        share: async (ctx: RequestContext) => {
          await new Promise((r) => setTimeout(r, 1))
          ctx.set('sharedAt', 'share')
          const viewer = Container.getInstance().resolve(VIEWER)
          return {
            viewer,
            // The same instance within the request.
            sameViewer: Container.getInstance().resolve(VIEWER) === viewer,
            fromHandler: ctx.get('fromHandler') ?? null,
            // The error page for a throwing handler sees the handler's request.
            sameAsHandler: (ctx.get('handlerViewer') ?? viewer) === viewer,
            sharedAt: ctx.get('sharedAt'),
          }
        },
      }),
    ],
    onError: inertiaErrorHandler(),
    onNotFound: inertiaNotFound(),
  })
  await app.setup()
  return app
}

const X = { 'X-Inertia': 'true', 'X-Inertia-Version': 'v1' }
const pageOf = (text: string) =>
  JSON.parse(/<script data-page="app" type="application\/json">(.*?)<\/script>/.exec(text)![1])

for (const rt of RUNTIMES)
  describe(`share() inside the request — ${rt.name}`, () => {
    beforeEach(() => Container.reset())

    it('on a first visit', async () => {
      const app = await makeApp(rt)
      const res = await request(app.handle.bind(app)).get('/dashboard').expect(200)
      expect(pageOf(res.text).props).toMatchObject({
        viewer: { id: 1 },
        sameViewer: true,
        fromHandler: 'yes',
        sharedAt: 'share',
      })
    })

    it('on an Inertia visit, with a fresh instance per request', async () => {
      const app = await makeApp(rt)
      await request(app.handle.bind(app)).get('/dashboard').set(X).expect(200)
      const res = await request(app.handle.bind(app)).get('/dashboard').set(X).expect(200)
      expect(res.body.props).toMatchObject({ viewer: { id: 2 }, sameViewer: true })
    })

    it('on the error page for an unknown URL', async () => {
      const app = await makeApp(rt)
      const res = await request(app.handle.bind(app))
        .get('/nowhere')
        .set('Accept', 'text/html')
        .expect(404)
      expect(pageOf(res.text).props).toMatchObject({
        status: 404,
        viewer: { id: 1 },
        sameViewer: true,
        sharedAt: 'share',
      })
    })

    it('on the error page for a handler that throws', async () => {
      const app = await makeApp(rt)
      const res = await request(app.handle.bind(app)).get('/broken').set(X).expect(500)
      expect(res.body.component).toBe('Error')
      expect(res.body.props).toMatchObject({
        viewer: { id: 1 },
        sameViewer: true,
        fromHandler: 'yes',
        sameAsHandler: true,
      })
    })
  })

// A body Fastify can't parse fails before any route runs, so before a route
// store exists. The error page still runs in one, with or without the
// auto-mounted request scope. (The status is a separate matter: Fastify's
// own errors aren't HttpExceptions, so the page reports 500.)
for (const [rt, contextStore] of [
  [RUNTIMES[1], 'auto'],
  [RUNTIMES[1], 'manual'],
  [RUNTIMES[2], 'auto'],
] as const)
  describe(`share() inside the request — ${rt.name}, contextStore: '${contextStore}'`, () => {
    beforeEach(() => Container.reset())

    it('on the error page for a body that does not parse', async () => {
      const app = await makeApp(rt, contextStore)
      const res = await request(app.handle.bind(app))
        .post('/save')
        .set(X)
        .set('Content-Type', 'application/json')
        .send('{"broken"')
      expect(res.body.component).toBe('Error')
      expect(res.body.props).toMatchObject({
        viewer: { id: 1 },
        sameViewer: true,
        sharedAt: 'share',
      })
    })
  })
