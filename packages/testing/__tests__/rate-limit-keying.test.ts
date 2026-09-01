/**
 * #614: which address the rate limiter buckets on, and why.
 *
 * The security property is the point: an UNTRUSTED `x-forwarded-for` must not
 * create buckets, or a direct caller mints a fresh allowance per request by
 * varying the header — evading the limit instead of being held by it. Behind a
 * configured proxy the header is vetted by the runtime and does bucket.
 *
 * @module @forinda/kickjs-testing/__tests__/rate-limit-keying.test
 */
import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { Controller, Get, Middleware, defineModule, rateLimitGuard } from '@forinda/kickjs'
import { expressRuntime } from '@forinda/kickjs'
import { fastifyRuntime } from '../../kickjs/src/http/runtimes/fastify'
import { h3Runtime } from '../../kickjs/src/http/runtimes/h3'
import { createTestApp } from '../src'

/**
 * A fresh controller per run. `rateLimitGuard(...)` is evaluated where the
 * decorator is written — at class-definition time — so a module-level
 * controller shares ONE in-memory store across every app in the file, and the
 * second runtime to run starts against an already-exhausted bucket.
 */
function makeModule() {
  @Controller()
  class LimitedController {
    @Middleware(rateLimitGuard({ max: 1, windowMs: 60_000 }))
    @Get('/')
    hit(ctx: any) {
      return ctx.json({ ok: true })
    }
  }

  return defineModule({
    name: 'LimitedModule',
    build: () => ({
      routes() {
        return { path: '/lim', controller: LimitedController, version: false, prefix: false }
      },
    }),
  })
}

const runtimes = [
  { name: 'express', make: () => expressRuntime() },
  { name: 'fastify', make: () => fastifyRuntime() },
  { name: 'h3', make: () => h3Runtime() },
]

async function statuses(make: () => any, trustProxy: boolean): Promise<number[]> {
  const { app } = await createTestApp({ modules: [makeModule()()], runtime: make(), trustProxy })
  const send = (xff: string) =>
    request(app.handle.bind(app))
      .get('/lim')
      .set('x-forwarded-for', xff)
      .then((r) => r.status)
  return [await send('1.1.1.1'), await send('1.1.1.1'), await send('2.2.2.2')]
}

describe.each(runtimes)('rate-limit keying on $name', ({ make }) => {
  it('ignores an untrusted x-forwarded-for, so the header cannot mint buckets', async () => {
    // Third request carries a different XFF and is still limited: without a
    // configured proxy the header is unverified and must not be believed.
    expect(await statuses(make, false)).toEqual([200, 429, 429])
  })

  it('buckets per client once trustProxy is configured', async () => {
    expect(await statuses(make, true)).toEqual([200, 429, 200])
  })
})
