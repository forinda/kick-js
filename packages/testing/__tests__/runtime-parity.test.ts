/**
 * The harness must exercise the engine the app actually deploys on.
 *
 * `createTestApp` hardcoded Express and returned `expressApp`, so a project
 * running Fastify or h3 in production had its whole suite passing against a
 * different engine — the one thing an integration test exists to rule out.
 * Routing, body parsing, status handling and error mapping all live in the
 * runtime seam, so a green Express suite says nothing about them.
 *
 * @module @forinda/kickjs-testing/__tests__/runtime-parity.test
 */

import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { Controller, Get, Post, type RequestContext } from '@forinda/kickjs'
import { expressRuntime } from '@forinda/kickjs'
// Source path, not the '@forinda/kickjs/fastify' subpath: this package's
// vitest alias maps the bare specifier straight at src/index.ts.
import { fastifyRuntime } from '../../kickjs/src/http/runtimes/fastify'

import { createTestApp, createTestModule } from '../src/index'

@Controller()
class ThingsController {
  @Get('/')
  list(_ctx: RequestContext) {
    return [{ id: '1' }]
  }

  @Post('/')
  create(ctx: RequestContext) {
    return { received: (ctx.body as { name?: string })?.name ?? null }
  }
}

const ThingsModule = createTestModule({
  register: () => {},
  routes: () => ({ path: '/things', controller: ThingsController }),
})

const runtimes = [
  { name: 'express', make: () => expressRuntime() },
  { name: 'fastify', make: () => fastifyRuntime() },
] as const

describe.each(runtimes)('createTestApp on $name', ({ make }) => {
  // No `middleware` — the default path is the one that matters. Passing
  // `express.json()` explicitly bypasses the Application's native-body guard,
  // and under Fastify the connect parser then eats the stream before Fastify
  // reads it, so a JSON POST hangs. An earlier revision of this suite passed
  // `middleware: []` for Fastify and never exercised it.
  async function boot() {
    const { app, container } = await createTestApp({
      modules: [ThingsModule],
      runtime: make(),
      isolated: true,
    })
    return { app, container, agent: request(app.handle.bind(app)) }
  }

  it('reports the runtime it was actually given', async () => {
    const { app } = await boot()
    expect(app.getActiveRuntime().name).toBe(make().name)
  })

  it('routes a GET through the real engine', async () => {
    const { agent } = await boot()
    const res = await agent.get('/api/v1/things')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([{ id: '1' }])
  })

  it('parses a JSON body with the DEFAULT middleware', async () => {
    // Body parsing is runtime-specific: Fastify parses natively, Express needs
    // `express.json()`. Getting the default wrong does not fail — it hangs.
    const { agent } = await boot()
    const res = await agent.post('/api/v1/things').send({ name: 'widget' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ received: 'widget' })
  })

  it('404s an unknown route through the real engine', async () => {
    const { agent } = await boot()
    expect((await agent.get('/api/v1/nope')).status).toBe(404)
  })
})

describe('expressApp escape hatch', () => {
  it('still works under Express', async () => {
    const { expressApp } = await createTestApp({ modules: [ThingsModule], isolated: true })
    expect((await request(expressApp).get('/api/v1/things')).status).toBe(200)
  })

  it('refuses to hand back another engine mistyped as Express', async () => {
    // It used to return the Fastify instance cast to `express.Express`, which
    // is how a suite silently exercises the wrong runtime.
    const result = await createTestApp({
      modules: [ThingsModule],
      runtime: fastifyRuntime(),
      isolated: true,
    })
    expect(() => result.expressApp).toThrow(/only available under the Express runtime/)
  })
})
