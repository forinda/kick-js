/**
 * Every shipped middleware, mounted on every runtime.
 *
 * The existing "engine-neutral" tests check the HELPERS in isolation —
 * `resolveClientIp`, `resolvePathname` — not that a middleware behaves the same
 * once it is actually mounted. Connect middleware receives an Express request
 * under Express and a raw node request under Fastify and h3, so anything that
 * reads an Express convenience diverges only when driven end to end.
 *
 * Four bugs this session were h3-only and invisible because the tests compared
 * Express with Fastify — the pair that already agrees. This is the sweep.
 *
 * @module @forinda/kickjs-testing/__tests__/middleware-runtime-matrix.test
 */

import { describe, expect, it } from 'vitest'
import request from 'supertest'
import {
  Controller,
  Get,
  Post,
  cors,
  csrf,
  helmet,
  session,
  rateLimit,
  requestId,
  expressRuntime,
  type RequestContext,
} from '@forinda/kickjs'

// Source paths: this package's vitest alias maps the bare specifier at src/index.ts.
import { fastifyRuntime } from '../../kickjs/src/http/runtimes/fastify'
import { h3Runtime } from '../../kickjs/src/http/runtimes/h3'
import { createTestApp, createTestModule } from '../src/index'

@Controller()
class ProbeController {
  @Get('/ping')
  ping(_ctx: RequestContext) {
    return { ok: true }
  }

  @Post('/ping')
  post(_ctx: RequestContext) {
    return { ok: true }
  }

  @Get('/visit')
  visit(ctx: RequestContext) {
    // Session payload lives under `.data`; `ctx.session` is the handle.
    const session = ctx.session as { data: { count?: number } } | undefined
    if (!session) return { count: null }
    session.data.count = (session.data.count ?? 0) + 1
    return { count: session.data.count }
  }
}

const ProbeModule = createTestModule({
  register: () => {},
  routes: () => ({ path: '/probe', controller: ProbeController }),
})

const runtimes = [
  { name: 'express', make: () => expressRuntime() },
  { name: 'fastify', make: () => fastifyRuntime() },
  { name: 'h3', make: () => h3Runtime() },
] as const

const URL = '/api/v1/probe/ping'

describe.each(runtimes)('middleware on $name', ({ make }) => {
  async function boot(middleware: unknown[]) {
    const { app } = await createTestApp({
      modules: [ProbeModule],
      runtime: make(),
      middlewares: middleware as never,
      isolated: true,
    })
    return request(app.handle.bind(app))
  }

  describe('cors', () => {
    it('allows a configured origin on a real request', async () => {
      const agent = await boot([cors({ origin: 'https://app.example.com' })])
      const res = await agent.get(URL).set('Origin', 'https://app.example.com')
      expect(res.headers['access-control-allow-origin']).toBe('https://app.example.com')
    })

    it('answers a preflight without reaching the handler', async () => {
      // The preflight short-circuits: a 200 carrying the handler's body would
      // mean OPTIONS fell through to the route.
      const agent = await boot([cors({ origin: 'https://app.example.com' })])
      const res = await agent
        .options(URL)
        .set('Origin', 'https://app.example.com')
        .set('Access-Control-Request-Method', 'POST')
      expect(res.status).toBeLessThan(300)
      expect(res.headers['access-control-allow-methods']).toBeTruthy()
      expect(res.body).not.toHaveProperty('ok')
    })
  })

  describe('helmet', () => {
    it('sets the security headers', async () => {
      const agent = await boot([helmet()])
      const res = await agent.get(URL)
      expect(res.headers['x-content-type-options']).toBe('nosniff')
      expect(res.headers['x-frame-options']).toBeTruthy()
    })
  })

  describe('requestId', () => {
    it('echoes a client-supplied id', async () => {
      const agent = await boot([requestId()])
      const res = await agent.get(URL).set('X-Request-Id', 'abc-123')
      expect(res.headers['x-request-id']).toBe('abc-123')
    })

    it('generates one when the client sends none', async () => {
      const agent = await boot([requestId()])
      const res = await agent.get(URL)
      expect(res.headers['x-request-id']).toBeTruthy()
    })
  })

  describe('rateLimit', () => {
    it('rejects past the limit', async () => {
      const agent = await boot([rateLimit({ max: 2, windowMs: 60_000 })])
      expect((await agent.get(URL)).status).toBe(200)
      expect((await agent.get(URL)).status).toBe(200)
      expect((await agent.get(URL)).status).toBe(429)
    })
  })

  describe('session', () => {
    it('issues a cookie and reads it back on the next request', async () => {
      // `session` set its cookie with `res.cookie()`, which the raw node
      // response under Fastify and h3 does not have — so the cookie was never
      // issued and every request looked like a new visitor.
      const { app } = await createTestApp({
        modules: [ProbeModule],
        runtime: make(),
        middlewares: [session({ secret: 'test-secret-value' })] as never,
        isolated: true,
      })
      // A supertest *agent* keeps the cookie jar between requests, which is the
      // whole point here — plain `request()` sends none back.
      const agent = request.agent(app.handle.bind(app))

      const first = await agent.get('/api/v1/probe/visit')
      expect(first.status).toBe(200)
      expect(first.body).toEqual({ count: 1 })
      expect(first.headers['set-cookie'], 'no session cookie was issued').toBeTruthy()

      const second = await agent.get('/api/v1/probe/visit')
      expect(second.body).toEqual({ count: 2 })
    })
  })

  describe('csrf', () => {
    it('rejects an unsafe method with no token', async () => {
      const agent = await boot([csrf()])
      expect((await agent.post(URL)).status).toBe(403)
    })

    it('leaves a safe method alone', async () => {
      const agent = await boot([csrf()])
      expect((await agent.get(URL)).status).toBe(200)
    })

    it('accepts a request that returns the token it issued', async () => {
      // The double-submit flow end to end: take the cookie the middleware set,
      // send it back with the matching header. csrf read `req.cookies`, which
      // only Express populates — under Fastify and h3 it saw no cookie, minted
      // a NEW token, and compared the submitted header against that, so a
      // client could never complete a protected request.
      const { app } = await createTestApp({
        modules: [ProbeModule],
        runtime: make(),
        middlewares: [csrf()] as never,
        isolated: true,
      })
      const agent = request.agent(app.handle.bind(app))

      const seed = await agent.get(URL)
      const setCookie = seed.headers['set-cookie']
      expect(setCookie, 'no csrf cookie was issued').toBeTruthy()
      const token = /_csrf=([^;]+)/.exec(String(setCookie))?.[1]
      expect(token, 'could not read the token out of the cookie').toBeTruthy()

      const res = await agent.post(URL).set('x-csrf-token', decodeURIComponent(token!))
      expect(res.status).toBe(200)
    })

    it('honours ignorePaths', async () => {
      // The path is read off the request; under Fastify and h3 that is a raw
      // node request with no `req.path`, which is how this silently did nothing.
      const agent = await boot([csrf({ ignorePaths: ['/api/v1/probe/ping'] })])
      expect((await agent.post(URL)).status).toBe(200)
    })
  })
})
