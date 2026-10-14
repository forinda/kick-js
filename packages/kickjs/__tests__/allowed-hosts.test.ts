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
  allowedHosts,
  expressRuntime,
  type RequestContext,
} from '../src/index'

const run = (host: string | undefined, options: Parameters<typeof allowedHosts>[0], extra = {}) => {
  let status = 0
  let nexted = false
  const res = {
    status: (code: number) => ((status = code), res),
    json: () => {},
    setHeader: () => {},
    getHeader: () => undefined,
  }
  allowedHosts(options)(
    { method: 'GET', url: '/x', headers: host === undefined ? {} : { host, ...extra } } as never,
    res as never,
    (() => (nexted = true)) as never,
  )
  return nexted ? 'next' : status
}

describe('allowedHosts()', () => {
  it('matches exact hosts and dot-prefixed domains, ignoring port and case', () => {
    const hosts = ['example.com', '.example.org']
    expect(run('example.com', hosts)).toBe('next')
    expect(run('EXAMPLE.com:8080', hosts)).toBe('next')
    expect(run('example.org', hosts)).toBe('next')
    expect(run('api.example.org', hosts)).toBe('next')
    expect(run('www.example.com', hosts)).toBe(400)
    expect(run('evilexample.org', hosts)).toBe(400)
    expect(run('evil.com', hosts)).toBe(400)
  })

  it('refuses a missing or malformed Host', () => {
    expect(run(undefined, ['example.com'])).toBe(400)
    for (const host of ['x@example.com', 'example.com/', 'example.com evil']) {
      expect(run(host, ['example.com'])).toBe(400)
    }
  })

  it("reads X-Forwarded-Host only when told to, taking the nearest proxy's value", () => {
    // The client sent `evil.test`; the proxy appended the host it served.
    const appended = { 'x-forwarded-host': 'evil.test, example.com' }
    expect(run('10.0.0.5:3000', ['example.com'], appended)).toBe(400)
    const trusted = { hosts: ['example.com'], trustForwardedHost: true }
    expect(run('10.0.0.5:3000', trusted, appended)).toBe('next')
    expect(run('10.0.0.5:3000', trusted, { 'x-forwarded-host': 'example.com, evil.test' })).toBe(
      400,
    )
  })

  it('exempts ignorePaths for GET and HEAD only', () => {
    const options = { hosts: ['example.com'], ignorePaths: ['/x'] }
    expect(run('10.0.0.5', options)).toBe('next')
    let status = 0
    const res = {
      status: (code: number) => ((status = code), res),
      json: () => {},
      setHeader: () => {},
      getHeader: () => undefined,
    }
    allowedHosts(options)(
      { method: 'POST', url: '/x', headers: { host: '10.0.0.5' } } as never,
      res as never,
      (() => {}) as never,
    )
    expect(status).toBe(400)
  })

  it('validates its list when created', () => {
    expect(() => allowedHosts([])).toThrow(/at least one/)
    expect(() => allowedHosts(['https://example.com'])).toThrow(/not a host name/)
    expect(run('anything.test', ['*'])).toBe('next')
  })
})

const RUNTIMES = [
  ['express', () => expressRuntime()],
  ['fastify', () => fastifyRuntime()],
  ['h3', () => h3Runtime()],
] as const

for (const [name, runtime] of RUNTIMES)
  describe(`bootstrap({ security: { allowedHosts } }) — ${name}`, () => {
    beforeEach(() => Container.reset())

    it('refuses other hosts but always answers the health probes', async () => {
      @Controller()
      class C {
        @Get('/me')
        me(ctx: RequestContext) {
          ctx.json({ ok: true })
        }
      }
      const app = new Application({
        runtime: runtime(),
        security: { allowedHosts: ['example.com'] },
        modules: [{ routes: () => ({ path: '/u', controller: C }) } as never],
      })
      await app.setup()
      const http = request(app.handle.bind(app))

      await http.get('/api/v1/u/me').set('Host', 'example.com').expect(200)
      const refused = await http.get('/api/v1/u/me').set('Host', 'evil.test').expect(400)
      expect(refused.headers['content-type']).toContain('application/problem+json')
      expect(JSON.stringify(refused.body)).not.toContain('evil.test')
      // Kubernetes probes the pod IP.
      await http.get('/health/live').set('Host', '10.0.0.5:3000').expect(200)
      await http.get('/health/ready').set('Host', '10.0.0.5:3000').expect(200)
    })

    it('also covers routes adapters register before the middleware chain', async () => {
      const app = new Application({
        runtime: runtime(),
        security: { allowedHosts: ['example.com'] },
        modules: [],
        adapters: [
          {
            name: 'Docs',
            beforeMount({ http }) {
              http.route('GET', '/docs', (ctx) => ctx.json({ docs: true }))
            },
          },
        ],
      })
      await app.setup()
      const http = request(app.handle.bind(app))
      await http.get('/docs').set('Host', 'example.com').expect(200)
      await http.get('/docs').set('Host', 'evil.test').expect(400)
    })
  })
