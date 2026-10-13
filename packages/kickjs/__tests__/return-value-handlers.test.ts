import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import * as h3v2 from 'h3-v2'

import { Application } from '../src/http/application'
import { Container } from '../src/core/container'
import { Controller, Get, Post } from '../src/core/decorators'
import { reply, RESPOND } from '../src/http/reply'
import { expressRuntime } from '../src/http/runtimes/express'
import { fastifyRuntime } from '../src/http/runtimes/fastify'
import { h3Runtime } from '../src/http/runtimes/h3'
import { createWebApp } from '../src/web'
import type { HttpRuntime } from '../src/http/runtime'
import type { RequestContext } from '../src/http/context'

/**
 * Return-value handlers: handlers may
 * RETURN the payload instead of calling ctx.json; runtimes auto-send when
 * the pipeline finished with nothing written. Conformance across express /
 * fastify / h3 v1 (supertest) and the web entry (fetch).
 */

function makeControllers() {
  @Controller()
  class ReturnsController {
    @Get('/plain')
    plain(_ctx: RequestContext) {
      return { via: 'return' }
    }

    @Get('/async')
    async asyncPlain(_ctx: RequestContext) {
      return [1, 2, 3]
    }

    @Get('/ok')
    ok(_ctx: RequestContext) {
      return reply.ok({ via: 'reply.ok' })
    }

    @Post('/created')
    create(_ctx: RequestContext) {
      return reply(201, { id: 'x1' })
    }

    @Get('/gone')
    gone(_ctx: RequestContext) {
      return reply.noContent()
    }

    @Get('/accepted-empty')
    // Undefined body must NOT coerce the declared status to 204.
    acceptedEmpty(_ctx: RequestContext) {
      return reply(202, undefined)
    }

    @Get('/ctx-wins')
    ctxWins(ctx: RequestContext) {
      ctx.json({ via: 'ctx' })
      return { via: 'return-must-be-ignored' }
    }

    @Get('/bigint')
    // A database count or bigint column: sent as its decimal string, not a 500.
    bigint(_ctx: RequestContext) {
      return { count: 2n ** 64n, rows: [{ id: 7n }] }
    }

    @Get('/respondable')
    // A value that writes its own response, asynchronously.
    respondable(_ctx: RequestContext) {
      return {
        async [RESPOND](ctx: RequestContext) {
          await Promise.resolve()
          ctx.setHeader('x-self', 'yes')
          ctx.html('<p>self</p>', 201)
        },
      }
    }

    @Get('/respondable-throws')
    respondableThrows(_ctx: RequestContext) {
      return {
        async [RESPOND]() {
          throw new Error('render failed')
        },
      }
    }

    @Get('/xml')
    xml(ctx: RequestContext) {
      ctx.send('<urlset/>', { type: 'application/xml', status: 203 })
    }

    @Get('/text')
    text(ctx: RequestContext) {
      ctx.send('plain')
    }

    @Get('/bytes')
    bytes(ctx: RequestContext) {
      ctx.send(new Uint8Array([1, 2, 3]), { type: 'application/octet-stream' })
    }

    @Get('/go')
    go(ctx: RequestContext) {
      ctx.redirect('/api/v1/r/plain', 303)
    }

    @Get('/void')
    // Returns undefined AND writes via ctx — prior behavior untouched.
    voidStyle(ctx: RequestContext) {
      ctx.json({ via: 'imperative' })
    }
  }
  return ReturnsController
}

const RUNTIMES: Array<{ name: string; make: () => HttpRuntime }> = [
  { name: 'express', make: () => expressRuntime() },
  { name: 'fastify', make: () => fastifyRuntime() },
  { name: 'h3', make: () => h3Runtime() },
]

beforeEach(() => {
  Container.reset()
})

for (const rt of RUNTIMES) {
  describe(`return-value handlers — ${rt.name}`, () => {
    async function makeApp() {
      const app = new Application({
        runtime: rt.make(),
        modules: [{ routes: () => ({ path: '/r', controller: makeControllers() }) } as never],
      })
      await app.setup()
      return app
    }

    it('auto-sends a returned object as 200 json', async () => {
      const app = await makeApp()
      const res = await request(app.handle.bind(app)).get('/api/v1/r/plain').expect(200)
      expect(res.body).toEqual({ via: 'return' })
      expect(res.headers['content-type']).toMatch(/json/)
    })

    it('auto-sends an async returned array', async () => {
      const app = await makeApp()
      const res = await request(app.handle.bind(app)).get('/api/v1/r/async').expect(200)
      expect(res.body).toEqual([1, 2, 3])
    })

    it('reply(201, body) sets the status', async () => {
      const app = await makeApp()
      const res = await request(app.handle.bind(app)).post('/api/v1/r/created').expect(201)
      expect(res.body).toEqual({ id: 'x1' })
    })

    it('reply.ok() sends 200 with the body', async () => {
      const app = await makeApp()
      const res = await request(app.handle.bind(app)).get('/api/v1/r/ok').expect(200)
      expect(res.body).toEqual({ via: 'reply.ok' })
    })

    it('reply.noContent() sends an empty 204', async () => {
      const app = await makeApp()
      await request(app.handle.bind(app)).get('/api/v1/r/gone').expect(204)
    })

    it('an undefined body does not coerce the status to 204', async () => {
      const app = await makeApp()
      await request(app.handle.bind(app)).get('/api/v1/r/accepted-empty').expect(202)
    })

    it('ctx.json wins over a return value', async () => {
      const app = await makeApp()
      const res = await request(app.handle.bind(app)).get('/api/v1/r/ctx-wins').expect(200)
      expect(res.body).toEqual({ via: 'ctx' })
    })

    it('sends a bigint as its decimal string', async () => {
      const app = await makeApp()
      const res = await request(app.handle.bind(app)).get('/api/v1/r/bigint').expect(200)
      expect(res.body).toEqual({ count: '18446744073709551616', rows: [{ id: '7' }] })
      expect(res.headers['content-type']).toMatch(/json/)
    })

    it('a respondable writes its own response', async () => {
      const app = await makeApp()
      const res = await request(app.handle.bind(app)).get('/api/v1/r/respondable').expect(201)
      expect(res.text).toBe('<p>self</p>')
      expect(res.headers['x-self']).toBe('yes')
    })

    it('a respondable that throws reaches the error handler', async () => {
      const app = await makeApp()
      await request(app.handle.bind(app)).get('/api/v1/r/respondable-throws').expect(500)
    })

    it('ctx.send() sends a body with its content type', async () => {
      const app = await makeApp()
      const http = request(app.handle.bind(app))
      const xml = await http.get('/api/v1/r/xml').expect(203)
      expect(xml.headers['content-type']).toMatch(/^application\/xml/)
      expect(xml.text).toBe('<urlset/>')
      const text = await request(app.handle.bind(app)).get('/api/v1/r/text').expect(200)
      expect(text.headers['content-type']).toMatch(/^text\/plain/)
      expect(text.text).toBe('plain')
      const bytes = await request(app.handle.bind(app))
        .get('/api/v1/r/bytes')
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = []
          res.on('data', (c: Buffer) => chunks.push(c))
          res.on('end', () => done(null, Buffer.concat(chunks)))
        })
        .expect(200)
      expect([...(bytes.body as Buffer)]).toEqual([1, 2, 3])
    })

    it('ctx.redirect() sends the status and the Location', async () => {
      const app = await makeApp()
      const res = await request(app.handle.bind(app)).get('/api/v1/r/go').expect(303)
      expect(res.headers.location).toBe('/api/v1/r/plain')
    })

    it('imperative style is untouched', async () => {
      const app = await makeApp()
      const res = await request(app.handle.bind(app)).get('/api/v1/r/void').expect(200)
      expect(res.body).toEqual({ via: 'imperative' })
    })
  })
}

describe('return-value handlers — web entry (fetch)', () => {
  it('returned payloads, reply() statuses, and ctx precedence all hold', async () => {
    const app = createWebApp({
      h3: h3v2,
      modules: [{ routes: () => ({ path: '/r', controller: makeControllers() }) } as never],
    })

    const plain = await app.fetch(new Request('http://x/api/v1/r/plain'))
    expect(plain.status).toBe(200)
    expect(await plain.json()).toEqual({ via: 'return' })

    const created = await app.fetch(new Request('http://x/api/v1/r/created', { method: 'POST' }))
    expect(created.status).toBe(201)
    expect(await created.json()).toEqual({ id: 'x1' })

    const gone = await app.fetch(new Request('http://x/api/v1/r/gone'))
    expect(gone.status).toBe(204)
    expect(await gone.text()).toBe('')

    const ctxWins = await app.fetch(new Request('http://x/api/v1/r/ctx-wins'))
    expect(await ctxWins.json()).toEqual({ via: 'ctx' })

    const self = await app.fetch(new Request('http://x/api/v1/r/respondable'))
    expect(self.status).toBe(201)
    expect(await self.text()).toBe('<p>self</p>')

    const xml = await app.fetch(new Request('http://x/api/v1/r/xml'))
    expect(xml.status).toBe(203)
    expect(xml.headers.get('content-type')).toMatch(/^application\/xml/)
    expect(await xml.text()).toBe('<urlset/>')
    const bytes = await app.fetch(new Request('http://x/api/v1/r/bytes'))
    expect([...new Uint8Array(await bytes.arrayBuffer())]).toEqual([1, 2, 3])

    const big = await app.fetch(new Request('http://x/api/v1/r/bigint'))
    expect(big.status).toBe(200)
    expect(await big.json()).toEqual({ count: '18446744073709551616', rows: [{ id: '7' }] })
  })
})
