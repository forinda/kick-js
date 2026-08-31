/**
 * Catch-all and error handling must agree across runtimes.
 *
 * Express brings opinionated defaults — a 404 fall-through, an error middleware
 * signature, `originalUrl` — and the framework was written against them. The
 * other two engines reach the same shared middleware by a different road, so
 * anything the road changes shows up as a response that differs by runtime for
 * the same thrown value.
 *
 * h3 was the outlier: it routes every thrown value through `createError()`,
 * which wraps the original on `cause`. The shared handler then failed
 * `instanceof HttpException`, so a thrown `HttpException(418)` fell through to
 * the generic branch and gained a `requestId` the other two omit, and
 * `describeError` walked the chain to report `kaboom ← caused by kaboom`.
 *
 * @module @forinda/kickjs-testing/__tests__/error-parity.test
 */

import { describe, expect, it } from 'vitest'
import request from 'supertest'
import {
  Controller,
  Get,
  HttpException,
  expressRuntime,
  type RequestContext,
} from '@forinda/kickjs'

// Source paths: this package's vitest alias maps the bare specifier at src/index.ts.
import { fastifyRuntime } from '../../kickjs/src/http/runtimes/fastify'
import { h3Runtime } from '../../kickjs/src/http/runtimes/h3'
import { createTestApp, createTestModule } from '../src/index'

@Controller()
class ThingsController {
  @Get('/ok')
  ok(_ctx: RequestContext) {
    return { ok: true }
  }

  @Get('/boom')
  boom(_ctx: RequestContext): never {
    throw new Error('kaboom')
  }

  @Get('/teapot')
  teapot(_ctx: RequestContext): never {
    throw new HttpException(418, 'I am a teapot')
  }
}

const ThingsModule = createTestModule({
  register: () => {},
  routes: () => ({ path: '/things', controller: ThingsController }),
})

const runtimes = [
  { name: 'express', make: () => expressRuntime() },
  { name: 'fastify', make: () => fastifyRuntime() },
  { name: 'h3', make: () => h3Runtime() },
] as const

describe.each(runtimes)('error handling on $name', ({ make }) => {
  async function agent() {
    const { app } = await createTestApp({
      modules: [ThingsModule],
      runtime: make(),
      isolated: true,
    })
    return request(app.handle.bind(app))
  }

  it('404s an unknown route under the API prefix', async () => {
    const res = await (await agent()).get('/api/v1/nope')
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ message: 'Not Found' })
  })

  it('404s an unknown route at the root, outside the prefix', async () => {
    // The catch-all has to cover paths the router never mounted at all, not
    // just misses inside the API prefix.
    const res = await (await agent()).get('/definitely-nothing')
    expect(res.status).toBe(404)
  })

  it('404s a known path with the wrong method', async () => {
    const res = await (await agent()).delete('/api/v1/things/ok')
    expect(res.status).toBe(404)
  })

  it('maps a thrown HttpException to its own status and body', async () => {
    // Identical on all three: no `requestId` on an expected 4xx. h3 used to add
    // one because its wrapper defeated the `instanceof` check.
    const res = await (await agent()).get('/api/v1/things/teapot')
    expect(res.status).toBe(418)
    expect(res.body).toEqual({ message: 'I am a teapot' })
  })

  it('maps an unexpected throw to a 500 that names the error once', async () => {
    const res = await (await agent()).get('/api/v1/things/boom')
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Internal Server Error')
    // Correlation id on unexpected errors, in every environment.
    expect(res.body.requestId).toBeTruthy()
    // Once — h3's wrapper produced `kaboom ← caused by kaboom`.
    expect(res.body.error).toBe('Error: kaboom')
  })

  it('still serves a working route', async () => {
    const res = await (await agent()).get('/api/v1/things/ok')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })
})
