/**
 * createHandler: a KickJS app served as request handlers, with no listening
 * server — the serverless entry. Express has no fetch of its own, so its fetch
 * path forwards to an in-process 127.0.0.1 server; a runtime app that has
 * `fetch` (h3 v2) is used directly.
 *
 * @module @forinda/kickjs/__tests__/create-handler.test
 */
import 'reflect-metadata'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Container,
  Controller,
  Get,
  Post,
  RequestContext,
  createHandler,
  expressRuntime,
  type HttpRuntime,
  type KickHandler,
} from '../src/index'

const handlers: KickHandler[] = []
beforeEach(() => {
  Container.reset()
})
afterEach(async () => {
  while (handlers.length) await handlers.pop()!.close()
})

/** Declared per test, after Container.reset(), so the decorators register into the fresh container. */
function itemsModule(extra: Record<string, unknown> = {}) {
  @Controller()
  class ItemsController {
    @Get('/')
    list(ctx: RequestContext) {
      ctx.json({ items: ['a', 'b'], q: ctx.query.q ?? null })
    }

    @Post('/')
    create(ctx: RequestContext) {
      ctx.json({ received: ctx.body ?? null }, 201)
    }

    @Get('/cookies')
    cookies(ctx: RequestContext) {
      ctx.res.setHeader('set-cookie', ['a=1; Path=/', 'b=2; Path=/'])
      ctx.res.setHeader('x-kick', 'yes')
      ctx.json({ ok: true })
    }

    @Get('/host')
    host(ctx: RequestContext) {
      ctx.json({ forwardedHost: ctx.headers['x-forwarded-host'] ?? null })
    }

    @Get('/ip')
    ip(ctx: RequestContext) {
      ctx.json({ ip: ctx.ip ?? null })
    }
  }
  return { routes: () => ({ path: '/items', controller: ItemsController }), ...extra } as any
}

function handlerFor(options: Parameters<typeof createHandler>[0]): KickHandler {
  const handler = createHandler(options)
  handlers.push(handler)
  return handler
}

describe('createHandler — fetch on a Node-based runtime (Express)', () => {
  it('serves routes, bodies, query strings and framework errors through fetch', async () => {
    const handler = handlerFor({ modules: [itemsModule()] })

    const list = await handler.fetch(new Request('https://site.example/api/v1/items?q=kick'))
    expect(list.status).toBe(200)
    expect(await list.json()).toEqual({ items: ['a', 'b'], q: 'kick' })

    const created = await handler.fetch(
      new Request('https://site.example/api/v1/items', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'x' }),
      }),
    )
    expect(created.status).toBe(201)
    expect(await created.json()).toEqual({ received: { name: 'x' } })

    const missing = await handler.fetch(new Request('https://site.example/api/v1/nope'))
    expect(missing.status).toBe(404)
    expect(missing.headers.get('content-type')).toContain('application/problem+json')

    const wrongMethod = await handler.fetch(
      new Request('https://site.example/api/v1/items', { method: 'DELETE' }),
    )
    expect(wrongMethod.status).toBe(405)
  })

  // A body-less POST arrives as an empty stream; forwarded as-is, Node's fetch
  // rejects it ("fetch failed") and the function answers 500.
  it('forwards a POST with no body', async () => {
    const handler = handlerFor({ modules: [itemsModule()] })
    const res = await handler.fetch(
      new Request('https://site.example/api/v1/items', { method: 'POST' }),
    )
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ received: null })
  })

  it('keeps every Set-Cookie and custom header on the response', async () => {
    const handler = handlerFor({ modules: [itemsModule()] })
    const res = await handler.fetch(new Request('https://site.example/api/v1/items/cookies'))
    expect(res.headers.getSetCookie()).toEqual(['a=1; Path=/', 'b=2; Path=/'])
    expect(res.headers.get('x-kick')).toBe('yes')
  })

  it('drops the loopback hop’s connection headers from the response', async () => {
    const handler = handlerFor({ modules: [itemsModule()] })
    const res = await handler.fetch(new Request('https://site.example/api/v1/items'))
    expect(res.headers.get('connection')).toBeNull()
    expect(res.headers.get('keep-alive')).toBeNull()
    expect(res.headers.get('content-type')).toContain('application/json')
  })

  it('tells the app which host the platform received, since the hop is 127.0.0.1', async () => {
    const handler = handlerFor({ modules: [itemsModule()] })
    const res = await handler.fetch(new Request('https://site.example/api/v1/items/host'))
    expect(await res.json()).toEqual({ forwardedHost: 'site.example' })
  })
})

describe('createHandler — client IP behind the forwarding hop', () => {
  const fromPlatform = () =>
    new Request('https://site.example/api/v1/items/ip', {
      headers: { 'x-forwarded-for': '203.0.113.7' },
    })

  it('sees the loopback address without trustProxy', async () => {
    const handler = handlerFor({ modules: [itemsModule()] })
    const { ip } = (await (await handler.fetch(fromPlatform())).json()) as { ip: string }
    expect(ip).toMatch(/127\.0\.0\.1$/)
  })

  it("takes the client IP from X-Forwarded-For with trustProxy: 'loopback' (documented)", async () => {
    const handler = handlerFor({ modules: [itemsModule()], trustProxy: 'loopback' })
    const res = await handler.fetch(fromPlatform())
    expect(await res.json()).toEqual({ ip: '203.0.113.7' })
  })
})

describe('createHandler — node(req, res)', () => {
  it('serves a Node request directly', async () => {
    const handler = handlerFor({ modules: [itemsModule()] })
    const server = http.createServer((req, res) => void handler.node(req, res))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const port = (server.address() as AddressInfo).port
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/items`)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ items: ['a', 'b'], q: null })
    } finally {
      server.close()
    }
  })
})

describe('createHandler — lifecycle', () => {
  it('sets the app up once, even when the first requests arrive together', async () => {
    const onReady = vi.fn()
    const handler = handlerFor({ modules: [itemsModule()], plugins: [{ name: 'Probe', onReady }] })
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        handler.fetch(new Request('https://site.example/api/v1/items')),
      ),
    )
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200])
    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it('registers no process signal or error handlers — the platform owns the process', async () => {
    const events = ['SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection'] as const
    const before = events.map((e) => process.listenerCount(e))
    const handler = handlerFor({ modules: [itemsModule()] })
    await handler.ready()
    expect(events.map((e) => process.listenerCount(e))).toEqual(before)
  })

  it('retries setup on the next request after it fails', async () => {
    let failOnce = true
    const handler = handlerFor({
      modules: [
        itemsModule({
          register() {
            if (failOnce) {
              failOnce = false
              throw new Error('database briefly down')
            }
          },
        }),
      ],
    })
    await expect(handler.fetch(new Request('https://site.example/api/v1/items'))).rejects.toThrow(
      'database briefly down',
    )
    // No Container.reset(): in a deployed bundle the decorators ran once, at import.
    const res = await handler.fetch(new Request('https://site.example/api/v1/items'))
    expect(res.status).toBe(200)
  })

  it('shuts a failed setup down before the retry builds a new app', async () => {
    const shutdown = vi.fn()
    let failOnce = true
    const handler = handlerFor({
      modules: [itemsModule()],
      adapters: [{ name: 'Resource', shutdown }],
      plugins: [
        {
          name: 'FlakyReady',
          onReady() {
            if (failOnce) {
              failOnce = false
              throw new Error('warm-up failed')
            }
          },
        },
      ],
    })
    await expect(handler.ready()).rejects.toThrow('warm-up failed')
    expect(shutdown).toHaveBeenCalledTimes(1)
    const res = await handler.fetch(new Request('https://site.example/api/v1/items'))
    expect(res.status).toBe(200)
  })

  it('does not run afterStart, and close() shuts adapters down', async () => {
    const afterStart = vi.fn()
    const shutdown = vi.fn()
    const handler = createHandler({
      modules: [itemsModule()],
      adapters: [{ name: 'NeedsServer', afterStart, shutdown }],
    })
    await handler.fetch(new Request('https://site.example/api/v1/items'))
    expect(afterStart).not.toHaveBeenCalled()
    await handler.close()
    expect(shutdown).toHaveBeenCalledTimes(1)
  })
})

describe('createHandler — runtime with its own fetch', () => {
  it('uses the runtime app’s fetch instead of forwarding', async () => {
    const base = expressRuntime()
    const nativeFetch = vi.fn(async () => new Response('from native fetch', { status: 200 }))
    const runtime: HttpRuntime<any> = {
      ...base,
      name: 'fetch-native-test',
      createApp: (o) => Object.assign(base.createApp(o), { fetch: nativeFetch }),
    }
    const createServer = vi.spyOn(http, 'createServer')
    try {
      const handler = handlerFor({ modules: [itemsModule()], runtime })
      const res = await handler.fetch(new Request('https://site.example/api/v1/items'))
      expect(await res.text()).toBe('from native fetch')
      expect(nativeFetch).toHaveBeenCalledTimes(1)
      expect(createServer).not.toHaveBeenCalled()
    } finally {
      createServer.mockRestore()
    }
  })
})
