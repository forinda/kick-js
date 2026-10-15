import 'reflect-metadata'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { fastifyRuntime } from '../src/http/runtimes/fastify'
import { h3Runtime } from '../src/http/runtimes/h3'
import {
  Application,
  Container,
  Controller,
  Get,
  RequestHistogram,
  expressRuntime,
  metricsAdapter,
  type RequestContext,
} from '../src/index'

describe('RequestHistogram', () => {
  it('counts into cumulative buckets per method, route and status', () => {
    const h = new RequestHistogram([0.1, 1])
    h.observe({ method: 'GET', route: '/u/:id', status: 200, durationMs: 50 })
    h.observe({ method: 'GET', route: '/u/:id', status: 200, durationMs: 500 })
    h.observe({ method: 'GET', status: 404, durationMs: 1 })
    const out = h.render()
    const base = 'http_request_duration_seconds'
    const labels = 'method="GET",route="/u/:id",status="200"'
    expect(out).toContain(`${base}_bucket{${labels},le="0.1"} 1`)
    expect(out).toContain(`${base}_bucket{${labels},le="1"} 2`)
    expect(out).toContain(`${base}_bucket{${labels},le="+Inf"} 2`)
    expect(out).toContain(`${base}_count{${labels}} 2`)
    expect(out).toContain(`${base}_sum{${labels}} 0.55`)
    // No route matched: one series, not one per URL.
    expect(out).toContain(`${base}_count{method="GET",route="unmatched",status="404"} 1`)
  })

  it('sorts and deduplicates buckets, and rejects invalid ones', () => {
    const h = new RequestHistogram([1, 0.1, 1])
    h.observe({ method: 'GET', route: '/x', status: 200, durationMs: 50 })
    const bounds = [...h.render().matchAll(/le="([^"]+)"/g)].map((m) => m[1])
    expect(bounds).toEqual(['0.1', '1', '+Inf'])
    expect(() => new RequestHistogram([])).toThrow(/buckets/)
    expect(() => new RequestHistogram([0.1, Number.NaN])).toThrow(/buckets/)
    expect(() => new RequestHistogram([-1])).toThrow(/buckets/)
  })

  it('escapes label values', () => {
    const h = new RequestHistogram([1])
    h.observe({ method: 'GET', route: 'a"b\\c\nd', status: 200, durationMs: 1 })
    expect(h.render()).toContain('route="a\\"b\\\\c\\nd"')
  })
})

const RUNTIMES = [
  ['express', () => expressRuntime()],
  ['fastify', () => fastifyRuntime()],
  ['h3', () => h3Runtime()],
] as const

for (const [name, runtime] of RUNTIMES)
  describe(`metricsAdapter — ${name}`, () => {
    beforeEach(() => Container.reset())

    async function boot(token?: string) {
      @Controller()
      class C {
        @Get('/:id')
        show(ctx: RequestContext) {
          ctx.json({ id: ctx.params.id })
        }
      }
      const app = new Application({
        runtime: runtime(),
        adapters: [metricsAdapter({ token })],
        modules: [{ routes: () => ({ path: '/users', controller: C }) } as never],
      })
      await app.setup()
      return { app, http: request(app.handle.bind(app)) }
    }

    it('serves Prometheus text with the request histogram by route pattern', async () => {
      const { app, http } = await boot()
      await http.get('/api/v1/users/1').expect(200)
      await http.get('/api/v1/users/2').expect(200)
      await http.get('/nowhere/random').expect(404)

      const res = await http.get('/metrics').expect(200)
      expect(res.headers['content-type']).toMatch(/^text\/plain;/)
      expect(res.headers['content-type']).toContain('version=0.0.4')
      expect(res.text).toMatch(
        /http_request_duration_seconds_count\{method="GET",route="\/api\/v1\/users\/:id",status="200"\} 2/,
      )
      expect(res.text).toMatch(/route="unmatched",status="404"\} 1/)
      expect(res.text).toMatch(/^nodejs_heap_used_bytes \d+/m)
      expect(res.text).toMatch(/^nodejs_eventloop_lag_seconds [\d.e-]+/m)
      // The scrape doesn't count itself.
      expect(res.text).not.toContain('route="/metrics"')
      await app.shutdown()
    })

    it('requires the bearer token when one is set', async () => {
      const { app, http } = await boot('s3cret')
      await http.get('/metrics').expect(401)
      await http.get('/metrics').set('Authorization', 'Bearer wrong').expect(401)
      await http.get('/metrics').set('Authorization', 'Bearer s3cret').expect(200)
      await app.shutdown()
    })
  })
