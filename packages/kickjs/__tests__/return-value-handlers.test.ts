import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import * as h3v2 from 'h3-v2'

import { Application } from '../src/http/application'
import { Container } from '../src/core/container'
import { Controller, Get, Post } from '../src/core/decorators'
import { reply } from '../src/http/reply'
import { expressRuntime } from '../src/http/runtimes/express'
import { fastifyRuntime } from '../src/http/runtimes/fastify'
import { h3Runtime } from '../src/http/runtimes/h3'
import { createWebApp } from '../src/web'
import type { HttpRuntime } from '../src/http/runtime'
import type { RequestContext } from '../src/http/context'

/**
 * Return-value handlers (response-inference-design.md R1): handlers may
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

    @Post('/created')
    create(_ctx: RequestContext) {
      return reply(201, { id: 'x1' })
    }

    @Get('/gone')
    gone(_ctx: RequestContext) {
      return reply.noContent()
    }

    @Get('/ctx-wins')
    ctxWins(ctx: RequestContext) {
      ctx.json({ via: 'ctx' })
      return { via: 'return-must-be-ignored' }
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

    it('reply.noContent() sends an empty 204', async () => {
      const app = await makeApp()
      await request(app.handle.bind(app)).get('/api/v1/r/gone').expect(204)
    })

    it('ctx.json wins over a return value', async () => {
      const app = await makeApp()
      const res = await request(app.handle.bind(app)).get('/api/v1/r/ctx-wins').expect(200)
      expect(res.body).toEqual({ via: 'ctx' })
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
  })
})
