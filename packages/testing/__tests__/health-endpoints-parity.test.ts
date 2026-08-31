/**
 * The built-in health routes, on every runtime.
 *
 * `/health/live` and `/health/ready` are the only routes the framework itself
 * mounts, and they were exercised on Express alone. Three of their four
 * branches used `ctx.res.status(...).json(...)` — the Express response API —
 * so under Fastify, where `ctx.res` is a `FastifyReply` with `.status()` but
 * no `.json()`, they threw and the error handler returned 500.
 *
 * That made readiness probes permanently fail on Fastify: a pod never becomes
 * ready. It stayed invisible because the ONE branch that used the neutral
 * `ctx.json()` — the happy path of `/health/live` — is exactly what a smoke
 * test curls.
 *
 * The draining branches matter for the same reason and are worse to lose: they
 * fail during the shutdown window they exist to cover.
 *
 * @module @forinda/kickjs-testing/__tests__/health-endpoints-parity.test
 */

import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { expressRuntime } from '@forinda/kickjs'

// Source path: this package's vitest alias maps the bare specifier at src/index.ts.
import { fastifyRuntime } from '../../kickjs/src/http/runtimes/fastify'
import { createTestApp, createTestModule } from '../src/index'

const EmptyModule = createTestModule({ register: () => {}, routes: () => null })

const runtimes = [
  { name: 'express', make: () => expressRuntime() },
  { name: 'fastify', make: () => fastifyRuntime() },
] as const

describe.each(runtimes)('built-in health routes on $name', ({ make }) => {
  async function boot(over: Record<string, unknown> = {}) {
    const { app } = await createTestApp({
      modules: [EmptyModule],
      runtime: make(),
      isolated: true,
      ...over,
    })
    return { app, agent: request(app.handle.bind(app)) }
  }

  it('GET /health/live reports ok', async () => {
    const { agent } = await boot()
    const res = await agent.get('/health/live')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
  })

  it('GET /health/ready reports ready with no adapters', async () => {
    const { agent } = await boot()
    const res = await agent.get('/health/ready')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'ready', checks: [] })
  })

  it('GET /health/ready reports 503 and degraded when an adapter is down', async () => {
    // The status is the whole point of the endpoint — an orchestrator reads it,
    // not the body — so a runtime that cannot set a non-200 breaks readiness
    // even when the JSON looks right.
    const { agent } = await boot({
      adapters: [{ name: 'db', onHealthCheck: async () => ({ name: 'db', status: 'down' }) }],
    })
    const res = await agent.get('/health/ready')
    expect(res.status).toBe(503)
    expect(res.body).toMatchObject({ status: 'degraded' })
    expect(res.body.checks).toEqual([{ name: 'db', status: 'down' }])
  })

  it('GET /health/ready survives an adapter whose check rejects', async () => {
    const { agent } = await boot({
      adapters: [
        {
          name: 'flaky',
          onHealthCheck: async () => {
            throw new Error('connection refused')
          },
        },
      ],
    })
    const res = await agent.get('/health/ready')
    expect(res.status).toBe(503)
    expect(res.body.checks).toEqual([{ name: 'flaky', status: 'down' }])
  })

  it.each(['/health/live', '/health/ready'])('%s reports draining, not 500', async (path) => {
    // Both draining branches used the Express-only form. They fire during
    // shutdown, so a throw here is a 500 exactly when the orchestrator is
    // deciding whether to keep routing traffic to this instance.
    const { app, agent } = await boot()
    ;(app as unknown as { _draining: boolean })._draining = true
    const res = await agent.get(path)
    expect(res.status).toBe(503)
    expect(res.body.status).toBe('draining')
  })
})
