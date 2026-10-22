/**
 * `share` runs inside the request: it can read and write the RequestContext
 * and resolve REQUEST-scoped services on every path that renders a page — a
 * route, an Inertia visit, an unknown URL and a handler that throws.
 */
import 'reflect-metadata'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { fastifyRuntime } from '@forinda/kickjs/fastify'
import { h3Runtime } from '@forinda/kickjs/h3'
import {
  Application,
  Container,
  Controller,
  Get,
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

async function makeApp(make: () => unknown) {
  @Controller()
  class PagesController {
    @Get('/dashboard')
    dashboard(ctx: RequestContext) {
      ctx.set('fromHandler', 'yes')
      return inertia('Dashboard')
    }

    @Get('/broken')
    broken() {
      throw new Error('boom')
    }
  }

  let viewers = 0
  Container.getInstance().registerFactory(VIEWER, () => ({ id: ++viewers }), Scope.REQUEST)

  const app = new Application({
    runtime: make() as never,
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
      const app = await makeApp(rt.make)
      const res = await request(app.handle.bind(app)).get('/dashboard').expect(200)
      expect(pageOf(res.text).props).toMatchObject({
        viewer: { id: 1 },
        sameViewer: true,
        fromHandler: 'yes',
        sharedAt: 'share',
      })
    })

    it('on an Inertia visit, with a fresh instance per request', async () => {
      const app = await makeApp(rt.make)
      await request(app.handle.bind(app)).get('/dashboard').set(X).expect(200)
      const res = await request(app.handle.bind(app)).get('/dashboard').set(X).expect(200)
      expect(res.body.props).toMatchObject({ viewer: { id: 2 }, sameViewer: true })
    })

    it('on the error page for an unknown URL', async () => {
      const app = await makeApp(rt.make)
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
      const app = await makeApp(rt.make)
      const res = await request(app.handle.bind(app)).get('/broken').set(X).expect(500)
      expect(res.body.component).toBe('Error')
      expect(res.body.props).toMatchObject({ viewer: { id: 1 }, sameViewer: true })
    })
  })
