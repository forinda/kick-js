/**
 * `compression()` (the Express middleware) in `bootstrap({ middlewares })`
 * works on every Node runtime — the documented way to compress responses.
 * Pinned here so it keeps working, and so SSE keeps streaming under it.
 */
import 'reflect-metadata'
import compression from 'compression'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { fastifyRuntime } from '../src/http/runtimes/fastify'
import { h3Runtime } from '../src/http/runtimes/h3'
import {
  Application,
  Container,
  Controller,
  Get,
  expressRuntime,
  type RequestContext,
} from '../src/index'

const RUNTIMES = [
  ['express', () => expressRuntime()],
  ['fastify', () => fastifyRuntime()],
  ['h3', () => h3Runtime()],
] as const

for (const [name, runtime] of RUNTIMES)
  describe(`compression() — ${name}`, () => {
    beforeEach(() => Container.reset())

    async function boot() {
      @Controller()
      class C {
        @Get('/big')
        big(ctx: RequestContext) {
          ctx.json({ text: 'x'.repeat(5000) })
        }
        @Get('/small')
        small(ctx: RequestContext) {
          ctx.json({ ok: true })
        }
        @Get('/events')
        events(ctx: RequestContext) {
          const stream = ctx.sse()
          stream.send({ n: 1 })
          stream.close()
        }
      }
      const app = new Application({
        runtime: runtime(),
        middlewares: [compression()],
        modules: [{ routes: () => ({ path: '/z', controller: C }) } as never],
      })
      await app.setup()
      return request(app.handle.bind(app))
    }

    it('gzips large responses and leaves small ones alone', async () => {
      const http = await boot()
      const big = await http.get('/api/v1/z/big').set('Accept-Encoding', 'gzip').expect(200)
      expect(big.headers['content-encoding']).toBe('gzip')
      expect(big.headers.vary).toMatch(/accept-encoding/i)
      expect(big.body.text).toHaveLength(5000)

      const small = await http.get('/api/v1/z/small').set('Accept-Encoding', 'gzip').expect(200)
      expect(small.headers['content-encoding']).toBeUndefined()
    })

    it('does not compress server-sent events, so they are not held back', async () => {
      const http = await boot()
      const res = await http.get('/api/v1/z/events').set('Accept-Encoding', 'gzip').expect(200)
      expect(res.headers['content-type']).toContain('text/event-stream')
      expect(res.headers['cache-control']).toContain('no-transform')
      expect(res.headers['content-encoding']).toBeUndefined()
      expect(res.text).toContain('data: {"n":1}')
    })
  })
