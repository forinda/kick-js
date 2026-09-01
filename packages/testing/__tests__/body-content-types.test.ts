/**
 * #590: the same body must parse the same way on every runtime.
 *
 * Before the shared body policy, each engine brought its own library's
 * opinion — Express parsed only exact `application/json` and left everything
 * else `undefined`, Fastify answered 415 for anything it had no parser for,
 * and h3 routed unrecognised types through `destr`. A form post worked on two
 * engines and 415'd on the third; a `+json` body parsed on one of three.
 *
 * @module @forinda/kickjs-testing/__tests__/body-content-types.test
 */
import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { Controller, Post, defineModule } from '@forinda/kickjs'
import { expressRuntime } from '@forinda/kickjs'
import { fastifyRuntime } from '../../kickjs/src/http/runtimes/fastify'
import { h3Runtime } from '../../kickjs/src/http/runtimes/h3'
import { createTestApp } from '../src'

@Controller()
class EchoController {
  @Post('/')
  echo(ctx: any) {
    return { type: typeof ctx.body, body: ctx.body ?? null }
  }
}

const EchoModule = defineModule({
  name: 'EchoModule',
  build: () => ({
    routes() {
      return { path: '/echo', controller: EchoController, version: false, prefix: false }
    },
  }),
})

const runtimes = [
  { name: 'express', make: () => expressRuntime() },
  { name: 'fastify', make: () => fastifyRuntime() },
  { name: 'h3', make: () => h3Runtime() },
]

async function post(make: () => any, contentType: string | null, payload: string) {
  const { app } = await createTestApp({ modules: [EchoModule()], runtime: make() })
  const req = request(app.handle.bind(app)).post('/echo')
  if (contentType) return req.set('content-type', contentType).send(payload)
  // superagent infers a content-type from the payload, so the no-content-type
  // case has to strip it AFTER send() has added one.
  return req.send(payload).unset('Content-Type')
}

describe.each(runtimes)('body content types on $name', ({ make }) => {
  it('parses application/json', async () => {
    const res = await post(make, 'application/json', '{"a":1}')
    expect(res.status).toBe(200)
    expect(res.body.body).toEqual({ a: 1 })
  })

  // RFC 6838 §4.2.8: a `+json` type MUST actually be JSON, so a generic parser
  // is sanctioned. Previously: undefined on Express, 415 on Fastify.
  it('parses application/*+json as JSON', async () => {
    const res = await post(make, 'application/merge-patch+json', '{"a":1}')
    expect(res.status).toBe(200)
    expect(res.body.body).toEqual({ a: 1 })
  })

  it('rejects a malformed +json body rather than passing a raw string', async () => {
    const res = await post(make, 'application/merge-patch+json', '{"a":')
    expect(res.status).toBe(400)
  })

  it('parses x-www-form-urlencoded', async () => {
    const res = await post(make, 'application/x-www-form-urlencoded', 'a=1&b=2')
    expect(res.status).toBe(200)
    expect(res.body.body).toEqual({ a: '1', b: '2' })
  })

  // text/* is CORS-safelisted — it crosses origins with no preflight, so
  // JSON-parsing it would re-open simple-request CSRF against a JSON API.
  it('hands text/plain through as a raw string, never JSON', async () => {
    const res = await post(make, 'text/plain', '{"a":1}')
    expect(res.status).toBe(200)
    expect(res.body.type).toBe('string')
    expect(res.body.body).toBe('{"a":1}')
  })

  it('still rejects malformed application/json', async () => {
    const res = await post(make, 'application/json', '{"a":')
    expect(res.status).toBe(400)
  })

  // The decision in #590: an unsupported type is REJECTED, not ignored, so the
  // sender learns the framework will not read what they sent instead of the
  // handler receiving `undefined` and failing somewhere less obvious.
  it('answers 415 for an unsupported content type', async () => {
    const res = await post(make, 'application/xml', '<a>1</a>')
    expect(res.status).toBe(415)
  })

  it('names the accepted types on a 415, per RFC 9110', async () => {
    const res = await post(make, 'application/xml', '<a>1</a>')
    expect(res.headers.accept).toContain('application/json')
    expect(res.headers.accept).toContain('application/x-www-form-urlencoded')
  })

  it('answers 415 for a body sent with no content-type at all', async () => {
    const res = await post(make, null, '{"a":1}')
    expect(res.status).toBe(415)
  })

  // 415 is for a body we cannot read — not for the absence of one. Spring and
  // ASP.NET both make this distinction, and a bodyless POST is legitimate.
  it('does NOT 415 a bodyless request, whatever its content type', async () => {
    const { app } = await createTestApp({ modules: [EchoModule()], runtime: make() })
    const res = await request(app.handle.bind(app))
      .post('/echo')
      .set('content-type', 'application/xml')
    expect(res.status).toBe(200)
    expect(res.body.body).toBeNull()
  })

  // An empty CHUNKED post carries `transfer-encoding` with no payload, so a
  // "was a body sent" check based on framing headers alone says yes. Rejecting
  // on that would 415 a request that sent nothing.
  it('does NOT 415 an empty chunked request with an unsupported type', async () => {
    const { app } = await createTestApp({ modules: [EchoModule()], runtime: make() })
    const res = await request(app.handle.bind(app))
      .post('/echo')
      .set('content-type', 'application/xml')
      .set('transfer-encoding', 'chunked')
      .send('')
    expect(res.status).toBe(200)
    expect(res.body.body).toBeNull()
  })

  it('still accepts a POST with no body', async () => {
    const { app } = await createTestApp({ modules: [EchoModule()], runtime: make() })
    const res = await request(app.handle.bind(app)).post('/echo')
    expect(res.status).toBe(200)
    expect(res.body.body).toBeNull()
  })
})
