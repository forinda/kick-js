import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import {
  Application,
  Container,
  Controller,
  Get,
  RequestContext,
  expressRuntime,
  type HttpRuntime,
} from '../src/index'

beforeEach(() => {
  Container.reset()
})

/**
 * Wrap the real Express runtime and record which seam methods fire. Proves the
 * `runtime` option is load-bearing in `Application` — i.e. M1b actually routed
 * the bootstrap path through the runtime rather than calling Express directly.
 */
function recordingRuntime() {
  const base = expressRuntime()
  const calls: Record<string, number> = {
    createApp: 0,
    useConnect: 0,
    mountRoutes: 0,
    serveStatic: 0,
    setNotFound: 0,
    setErrorHandler: 0,
    nodeHandler: 0,
  }
  const rt: HttpRuntime<ReturnType<typeof base.createApp>> = {
    name: 'express-recording',
    capabilities: base.capabilities,
    createApp: (o) => (calls.createApp++, base.createApp(o)),
    useConnect: (app, mw, opts) => (calls.useConnect++, base.useConnect(app, mw, opts)),
    mountRoutes: (app, table) => (calls.mountRoutes++, base.mountRoutes(app, table)),
    serveStatic: (app, p, d) => (calls.serveStatic++, base.serveStatic(app, p, d)),
    setNotFound: (app, mw) => (calls.setNotFound++, base.setNotFound(app, mw)),
    setErrorHandler: (app, mw) => (calls.setErrorHandler++, base.setErrorHandler(app, mw)),
    nodeHandler: (app) => (calls.nodeHandler++, base.nodeHandler(app)),
  }
  return { rt, calls }
}

describe('Application runtime seam (M1b)', () => {
  it('drives the configured runtime through bootstrap and serves requests', async () => {
    @Controller()
    class PingController {
      @Get('/ping')
      ping(ctx: RequestContext) {
        ctx.json({ pong: true })
      }
    }

    const { rt, calls } = recordingRuntime()
    const app = new Application({
      runtime: rt,
      apiPrefix: '/api',
      defaultVersion: 1,
      modules: [
        {
          routes: () => ({ path: '/probe', controller: PingController }),
        } as any,
      ],
    })
    await app.setup()

    // The runtime built the app, registered middleware + the route, and the
    // terminal not-found / error handlers.
    expect(calls.createApp).toBe(1)
    expect(calls.useConnect).toBeGreaterThan(0)
    expect(calls.setNotFound).toBe(1)
    expect(calls.setErrorHandler).toBe(1)

    // And it actually serves — through the same runtime app.
    const res = await request(app.getExpressApp()).get('/api/v1/probe/ping').expect(200)
    expect(res.body).toEqual({ pong: true })
  })

  it('defaults to expressRuntime when no runtime is supplied', async () => {
    @Controller()
    class HelloController {
      @Get('/')
      hi(ctx: RequestContext) {
        ctx.json({ hi: true })
      }
    }

    const app = new Application({
      apiPrefix: '/api',
      defaultVersion: 1,
      modules: [{ routes: () => ({ path: '/hello', controller: HelloController }) } as any],
    })
    await app.setup()

    await request(app.getExpressApp()).get('/api/v1/hello').expect(200, { hi: true })
  })
})
