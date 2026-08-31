/**
 * A malformed body is a client error on every runtime.
 *
 * The h3 runtime read the body with `.catch(() => undefined)`, which swallowed
 * a PARSE failure as well as an absent body. So broken JSON produced a 200 and
 * the handler ran against `undefined`, where Express and Fastify both answer
 * 400. Worse than the wrong status: the handler executed on data that was
 * never valid, and the client was told it succeeded.
 *
 * @module @forinda/kickjs-testing/__tests__/body-parse-errors.test
 */

import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { Controller, Post, expressRuntime, type RequestContext } from '@forinda/kickjs'

// Source paths: this package's vitest alias maps the bare specifier at src/index.ts.
import { fastifyRuntime } from '../../kickjs/src/http/runtimes/fastify'
import { h3Runtime } from '../../kickjs/src/http/runtimes/h3'
import { createTestApp, createTestModule } from '../src/index'

@Controller()
class EchoController {
  @Post('/')
  create(ctx: RequestContext) {
    return { got: (ctx.body as { a?: number })?.a ?? null }
  }
}

const EchoModule = createTestModule({
  register: () => {},
  routes: () => ({ path: '/echo', controller: EchoController }),
})

const runtimes = [
  { name: 'express', make: () => expressRuntime() },
  { name: 'fastify', make: () => fastifyRuntime() },
  { name: 'h3', make: () => h3Runtime() },
] as const

describe.each(runtimes)('body parsing on $name', ({ make }) => {
  async function agent() {
    const { app } = await createTestApp({ modules: [EchoModule], runtime: make(), isolated: true })
    return request(app.handle.bind(app))
  }

  it('rejects malformed JSON with a client error', async () => {
    const res = await (
      await agent()
    )
      .post('/api/v1/echo')
      .set('Content-Type', 'application/json')
      .send('{"a":')

    expect(res.status).toBe(400)
    // The handler must not have run — a success body here means the request was
    // accepted on data that never parsed.
    expect(res.body).not.toHaveProperty('got')
  })

  it('accepts a well-formed body', async () => {
    const res = await (await agent()).post('/api/v1/echo').send({ a: 1 })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ got: 1 })
  })

  it('still allows a request with no body at all', async () => {
    // The absent-body case is why the h3 catch existed; tightening it must not
    // turn "nothing sent" into an error.
    const res = await (await agent()).post('/api/v1/echo')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ got: null })
  })
})
