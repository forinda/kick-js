import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
// npm alias — the repo devDeps carry h3 v1 (for the v1 runtime's conformance
// suite) AND v2 side by side; this runtime targets v2, injected explicitly.
import * as h3v2 from 'h3-v2'

import {
  h3WebRuntime as h3WebRuntimeBase,
  type H3WebRuntimeOptions,
} from '../src/http/runtimes/h3-web'

const h3WebRuntime = (options: H3WebRuntimeOptions = {}) =>
  h3WebRuntimeBase({ h3: h3v2, ...options })
import { Container } from '../src/core/container'
import { requestStore, type RequestStore } from '../src/http/request-store'
import type { RouteEntry, RouteTable, ConnectMiddleware } from '../src/http/runtime'
import type { RequestContext } from '../src/http/context'

/**
 * Fetch-level tests for the h3 v2 (web-standards) runtime — the additive
 * sibling of the untouched v1 runtime. Exercises the shared web driver pair
 * end-to-end through real h3 v2 `app.fetch(new Request(...))`, no server.
 */

function entry(
  partial: Partial<RouteEntry> & Pick<RouteEntry, 'method' | 'path' | 'handler'>,
): RouteEntry {
  return { middlewares: [], contributorRunner: null, meta: {}, ...partial }
}

function mount(routes: RouteEntry[], mountPath = '/api'): ReturnType<typeof buildApp> {
  return buildApp([{ mountPath, routes }])
}

function buildApp(table: RouteTable) {
  const runtime = h3WebRuntime()
  const app = runtime.createApp()
  runtime.mountRoutes(app, table)
  // nodeHandler assembles the terminal catch-all (kick notFound bridge).
  runtime.nodeHandler(app)
  return { runtime, app }
}

beforeEach(() => {
  Container.reset()
  Container._requestStoreProvider = () => requestStore.getStore()
})

describe('h3WebRuntime — fetch round-trips', () => {
  it('routes GET and returns ctx.json payloads', async () => {
    const { app } = mount([
      entry({
        method: 'GET',
        path: '/hello/:name',
        handler: async (ctx: RequestContext) => {
          ctx.json({ hi: ctx.params.name, q: ctx.query.mode })
        },
      }),
    ])
    const res = await app.fetch(new Request('http://test/api/hello/world?mode=fast'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(await res.json()).toEqual({ hi: 'world', q: 'fast' })
  })

  it('parses JSON bodies and echoes ctx.created', async () => {
    const { app } = mount([
      entry({
        method: 'POST',
        path: '/things',
        handler: async (ctx: RequestContext) => {
          ctx.created({ got: ctx.body })
        },
      }),
    ])
    const res = await app.fetch(
      new Request('http://test/api/things', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ a: 1 }),
      }),
    )
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ got: { a: 1 } })
  })

  it('propagates x-request-id and mints one when absent', async () => {
    const { app } = mount([
      entry({
        method: 'GET',
        path: '/id',
        handler: async (ctx: RequestContext) => ctx.json({ id: ctx.requestId }) as unknown as void,
      }),
    ])
    const given = await app.fetch(
      new Request('http://test/api/id', { headers: { 'x-request-id': 'abc-123' } }),
    )
    expect(given.headers.get('x-request-id')).toBe('abc-123')
    expect((await given.json()).id).toBe('abc-123')

    const minted = await app.fetch(new Request('http://test/api/id'))
    expect(minted.headers.get('x-request-id')).toMatch(/[0-9a-f-]{36}/)
  })

  it('runs (ctx,next) middlewares in order and stops when one responds', async () => {
    const order: string[] = []
    const { app } = mount([
      entry({
        method: 'GET',
        path: '/guarded',
        middlewares: [
          async (_ctx, next) => {
            order.push('first')
            next()
          },
          async (ctx, _next) => {
            order.push('second')
            ctx.json({ error: 'nope' }, 403)
          },
        ],
        handler: async () => {
          order.push('handler — must not run')
        },
      }),
    ])
    const res = await app.fetch(new Request('http://test/api/guarded'))
    expect(res.status).toBe(403)
    expect(order).toEqual(['first', 'second'])
  })

  it('answers unmatched paths through the kick notFound bridge', async () => {
    const notFound: ConnectMiddleware = (_req: any, res: any) => {
      res.status(404).json({ error: 'custom-not-found' })
    }
    const runtime = h3WebRuntime()
    const app = runtime.createApp()
    runtime.mountRoutes(app, [{ mountPath: '/api', routes: [] }])
    runtime.setNotFound(app, notFound)
    runtime.nodeHandler(app)
    const res = await app.fetch(new Request('http://test/nope'))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'custom-not-found' })
  })

  it('maps handler throws through the error bridge', async () => {
    const errorMw: ConnectMiddleware = ((err: any, _req: any, res: any, _next: any) => {
      res.status(err.status ?? 500).json({ error: err.message })
    }) as unknown as ConnectMiddleware
    const runtime = h3WebRuntime()
    const app = runtime.createApp()
    runtime.mountRoutes(app, [
      {
        mountPath: '/api',
        routes: [
          entry({
            method: 'GET',
            path: '/boom',
            handler: async () => {
              const err = new Error('kaboom') as Error & { status: number }
              err.status = 418
              throw err
            },
          }),
        ],
      },
    ])
    runtime.setErrorHandler(app, errorMw)
    runtime.nodeHandler(app)
    const res = await app.fetch(new Request('http://test/api/boom'))
    expect(res.status).toBe(418)
    expect(await res.json()).toEqual({ error: 'kaboom' })
  })

  it('streams SSE over a web Response body', async () => {
    const { app } = mount([
      entry({
        method: 'GET',
        path: '/events',
        handler: async (ctx: RequestContext) => {
          const sse = ctx.sse()
          sse.send({ n: 1 })
          sse.send({ n: 2 })
          sse.close()
        },
      }),
    ])
    const res = await app.fetch(new Request('http://test/api/events'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const text = await res.text()
    expect(text).toContain('data: {"n":1}')
    expect(text).toContain('data: {"n":2}')
  })

  it('REQUEST-scoped ALS store is active inside handlers', async () => {
    let seen: RequestStore | undefined
    const { app } = mount([
      entry({
        method: 'GET',
        path: '/scope',
        handler: async (ctx: RequestContext) => {
          seen = requestStore.getStore()
          ctx.json({ ok: true })
        },
      }),
    ])
    await app.fetch(new Request('http://test/api/scope'))
    expect(seen).toBeDefined()
    expect(seen!.requestId).toBeTruthy()
  })

  it('multipart uploads land on ctx.body fields via FormData', async () => {
    const { app } = mount([
      entry({
        method: 'POST',
        path: '/upload',
        meta: {
          upload: { mode: 'single', fieldName: 'doc' } as never,
        },
        handler: async (ctx: RequestContext) => {
          const file = ctx.file as { originalname?: string; size?: number } | undefined
          ctx.json({ fields: ctx.body, file: file?.originalname, size: file?.size })
        },
      }),
    ])
    const form = new FormData()
    form.append('title', 'hello')
    form.append(
      'doc',
      new File([new Uint8Array([1, 2, 3])], 'a.bin', { type: 'application/octet-stream' }),
    )
    const res = await app.fetch(
      new Request('http://test/api/upload', { method: 'POST', body: form }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.fields).toEqual({ title: 'hello' })
    expect(body.file).toBe('a.bin')
    expect(body.size).toBe(3)
  })
})
