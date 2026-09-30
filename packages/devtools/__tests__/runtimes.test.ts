/**
 * The dashboard's HTTP surface under every runtime. Boots a real Application
 * per engine and drives it with supertest, so a handler that reaches for an
 * engine-specific request/response API fails here instead of in an adopter's
 * Fastify or h3 app.
 */
import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import request from 'supertest'
import { Application, Container, Controller, Get, type RequestContext } from '@forinda/kickjs'
import { DevToolsAdapter } from '@forinda/kickjs-devtools'
import { fastifyRuntime } from '../../kickjs/src/http/runtimes/fastify'
import { h3Runtime } from '../../kickjs/src/http/runtimes/h3'

const RUNTIMES = [
  ['express', undefined],
  ['fastify', fastifyRuntime],
  ['h3', h3Runtime],
] as const

beforeEach(() => {
  Container.reset()
})

async function boot(runtime: (() => unknown) | undefined, secret: string | false = false) {
  @Controller()
  class PingController {
    @Get('/:id')
    get(ctx: RequestContext) {
      ctx.json({ id: ctx.params.id })
    }
  }

  const app = new Application({
    modules: [
      {
        routes: () => ({ path: '/ping', controller: PingController }),
      } as never,
    ],
    adapters: [DevToolsAdapter({ enabled: true, secret, runtime: { enabled: false } })],
    ...(runtime ? { runtime: runtime() as never } : {}),
  })
  await app.setup()
  return Object.assign(request(app.handle.bind(app)), { app })
}

/** Read the first SSE event from a long-lived stream, then disconnect. */
async function firstEvent(app: Application, path: string) {
  const server = createServer((req, res) => app.handle(req, res))
  await new Promise<void>((resolve) => server.listen(0, resolve))
  const { port } = server.address() as AddressInfo
  const abort = new AbortController()
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { signal: abort.signal })
    const reader = res.body!.getReader()
    let text = ''
    while (!text.includes('\n\n')) {
      const { value, done } = await reader.read()
      if (done) break
      text += new TextDecoder().decode(value)
    }
    return { contentType: res.headers.get('content-type'), text }
  } finally {
    abort.abort()
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
}

describe.each(RUNTIMES)('DevTools under %s', (_name, runtime) => {
  it('serves the JSON endpoints', async () => {
    const http = await boot(runtime)

    const routes = await http.get('/_debug/routes').expect(200)
    expect(routes.body.routes).toContainEqual(
      expect.objectContaining({ method: 'GET', controller: 'PingController', handler: 'get' }),
    )

    const health = await http.get('/_debug/health').expect(200)
    expect(health.body.status).toBe('healthy')

    await http.get('/_debug/container').expect(200)
    await http.get('/_debug/graph').expect(200)
  })

  it('keys latency by the matched route pattern, not the raw URL', async () => {
    const http = await boot(runtime)
    await http.get('/api/v1/ping/1').expect(200)
    await http.get('/api/v1/ping/2').expect(200)
    await http.get('/nope').expect(404)

    const metrics = await http.get('/_debug/metrics').expect(200)
    const keys = Object.keys(metrics.body.routeLatency)
    const matched = keys.filter((k) => k.startsWith('GET ') && k.includes(':id'))
    expect(matched).toHaveLength(1)
    expect(metrics.body.routeLatency[matched[0]].count).toBe(2)
    expect(keys).toContain('GET <unmatched>')
    expect(metrics.body.clientErrors).toBeGreaterThanOrEqual(1)
  })

  it('reports 404 when the runtime sampler is off', async () => {
    const http = await boot(runtime)
    await http.get('/_debug/runtime').expect(404)
  })

  it('serves the dashboard page with the base path injected', async () => {
    const http = await boot(runtime)
    const page = await http.get('/_debug').expect(200)
    expect(page.headers['content-type']).toMatch(/text\/html/)
    expect(page.text).toContain('data-base="/_debug"')

    // The old Express mount redirected `/_debug` here; keep old links working.
    const slash = await http.get('/_debug/').redirects(1)
    expect(slash.status).toBe(200)
    expect(slash.text).toContain('data-base="/_debug"')
  })

  it('streams /stream as server-sent events', async () => {
    const { app } = await boot(runtime)
    const { contentType, text } = await firstEvent(app, '/_debug/stream')
    expect(contentType).toMatch(/text\/event-stream/)
    expect(text).toContain('"type":"metrics"')
  })

  it('guards the API with the token and leaves the page and assets open', async () => {
    const http = await boot(runtime, 's3cret')

    const denied = await http.get('/_debug/routes').expect(403)
    expect(denied.body.error).toMatch(/devtools token/)

    await http.get('/_debug/routes').set('x-devtools-token', 's3cret').expect(200)
    await http.get('/_debug/routes?token=s3cret').expect(200)

    await http.get('/_debug').expect(200)
    await http.get('/_debug?token=wrong').expect(403)
    await http.get('/_debug?token=s3cret').expect(200)

    const js = await http.get('/_debug/assets/index.js').expect(200)
    expect(js.headers['content-type']).toMatch(/javascript/)
    await http.get('/_debug/assets/style.css').expect(200)
  })
})
