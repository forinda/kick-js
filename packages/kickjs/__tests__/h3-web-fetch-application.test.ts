/**
 * A full Application on the h3 v2 runtime, invoked through `fetch` only.
 *
 * That is how a Netlify function, Bun, Deno or a Worker calls it: a WHATWG
 * Request, no node req/res on the event. Every default the Application mounts
 * (request tracking, request scope, helmet, requestId) is connect-style and was
 * bridged with h3's `fromNodeHandler`, which throws without a node response —
 * so every route answered 500 ("Executing Node.js middleware is not supported").
 *
 * The node path (`app.handle` → `toNodeHandler`) must keep working unchanged.
 */
import 'reflect-metadata'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'
import * as h3v2 from 'h3-v2'
import { Application, Container, Controller, Get, Post, type RequestContext } from '../src/index'
import { h3WebRuntime } from '../src/http/runtimes/h3-web'

const body = z.object({ name: z.string() })

@Controller()
class ItemsController {
  @Get('/')
  list(ctx: RequestContext) {
    ctx.json({ items: [], requestId: ctx.requestId })
  }

  @Get('/echo')
  echo(ctx: RequestContext) {
    ctx.json({ agent: ctx.headers['x-agent'], cookie: ctx.headers.cookie })
  }

  @Get('/boom')
  boom() {
    throw new Error('boom')
  }

  @Post('/', { body })
  create(ctx: RequestContext) {
    ctx.created({ name: (ctx.body as { name: string }).name })
  }
}
void ItemsController

type ConnectMw = (req: any, res: any, next: (err?: unknown) => void) => void

async function buildApp(middlewares?: ConnectMw[]) {
  const app = new Application({
    runtime: h3WebRuntime({ h3: h3v2 }),
    modules: [{ routes: () => ({ path: '/items', controller: ItemsController }) } as any],
    ...(middlewares ? { middlewares } : {}),
  })
  await app.setup()
  const h3 = app.getRuntimeApp() as unknown as { fetch(request: Request): Promise<Response> }
  return {
    app,
    fetch: (path: string, init?: RequestInit) => h3.fetch(new Request(`http://test${path}`, init)),
  }
}

const servers: http.Server[] = []
beforeEach(() => {
  Container.reset()
})
afterEach(() => {
  for (const s of servers.splice(0)) s.close()
})

describe('h3-web Application invoked through fetch', () => {
  it('serves a controller route with the default middleware applied', async () => {
    const { fetch } = await buildApp()
    const res = await fetch('/api/v1/items')
    expect(res.status).toBe(200)
    const json = (await res.json()) as { items: unknown[]; requestId: string }
    expect(json.items).toEqual([])
    // helmet ran (auto-mounted default)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    // one request id end to end: the header matches what the handler saw
    expect(res.headers.get('x-request-id')).toBe(json.requestId)
  })

  it('keeps an inbound x-request-id', async () => {
    const { fetch } = await buildApp()
    const res = await fetch('/api/v1/items', { headers: { 'x-request-id': 'abc-123' } })
    expect(res.headers.get('x-request-id')).toBe('abc-123')
    expect(((await res.json()) as { requestId: string }).requestId).toBe('abc-123')
  })

  it('answers an unknown path with the kick 404', async () => {
    const { fetch } = await buildApp()
    const res = await fetch('/api/v1/nope')
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toContain('application/problem+json')
    // middleware headers reach non-2xx responses too (h3 itself drops them there)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('x-request-id')).toBeTruthy()
  })

  it('answers a known path with the wrong method with 405', async () => {
    const { fetch } = await buildApp()
    const res = await fetch('/api/v1/items', { method: 'DELETE' })
    expect(res.status).toBe(405)
  })

  it('parses and validates a JSON body', async () => {
    const { fetch } = await buildApp()
    const ok = await fetch('/api/v1/items', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'pen' }),
    })
    expect(ok.status).toBe(201)
    expect(await ok.json()).toEqual({ name: 'pen' })

    const bad = await fetch('/api/v1/items', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 1 }),
    })
    expect(bad.status).toBe(422)
  })

  it('reads request headers and cookies', async () => {
    const { fetch } = await buildApp()
    const res = await fetch('/api/v1/items/echo', {
      headers: { 'x-agent': 'spike', cookie: 'sid=1' },
    })
    expect(await res.json()).toEqual({ agent: 'spike', cookie: 'sid=1' })
  })

  it('routes a handler throw through the error handler', async () => {
    const { fetch } = await buildApp()
    const res = await fetch('/api/v1/items/boom')
    expect(res.status).toBe(500)
  })

  it('runs user connect middleware: headers carry over, next(), and ending the response', async () => {
    const { fetch } = await buildApp([
      (_req, res, next) => {
        res.setHeader('x-from-mw', 'yes')
        next()
      },
      (req, res, next) => {
        if (req.url === '/api/v1/items/blocked') {
          res.statusCode = 403
          res.setHeader('content-type', 'text/plain')
          res.end('blocked by middleware')
          return
        }
        next()
      },
    ])
    const passed = await fetch('/api/v1/items')
    expect(passed.status).toBe(200)
    expect(passed.headers.get('x-from-mw')).toBe('yes')

    const blocked = await fetch('/api/v1/items/blocked')
    expect(blocked.status).toBe(403)
    expect(await blocked.text()).toBe('blocked by middleware')
    expect(blocked.headers.get('x-from-mw')).toBe('yes')
  })

  it('surfaces next(err) from connect middleware through the error handler', async () => {
    const { fetch } = await buildApp([(_req, _res, next) => next(new Error('mw failed'))])
    const res = await fetch('/api/v1/items')
    expect(res.status).toBe(500)
  })
})

describe('h3-web Application invoked through node (unchanged)', () => {
  it('serves routes, defaults and user connect middleware over a real http server', async () => {
    const { app } = await buildApp([
      (_req, res, next) => {
        res.setHeader('x-from-mw', 'yes')
        next()
      },
    ])
    const server = http.createServer((req, res) => app.handle(req, res))
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

    const ok = await fetch(`${base}/api/v1/items`)
    expect(ok.status).toBe(200)
    expect(ok.headers.get('x-content-type-options')).toBe('nosniff')
    expect(ok.headers.get('x-from-mw')).toBe('yes')

    expect((await fetch(`${base}/api/v1/nope`)).status).toBe(404)
  })
})
