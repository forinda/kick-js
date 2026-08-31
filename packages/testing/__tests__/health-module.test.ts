/**
 * The health endpoints as a module, rather than a raw engine mount.
 *
 * `http.route()` carries no decorators, so the OpenAPI generator — which builds
 * the spec by scanning controllers — could never see the two routes the
 * framework itself serves. They were also invisible in an adopter's code, so
 * people wrote their own `/health/ready` beside the built-in one.
 *
 * `health-endpoints-parity.test.ts` is the compatibility half: same paths, same
 * bodies, every runtime. This file covers what the move was FOR.
 *
 * @module @forinda/kickjs-testing/__tests__/health-module.test
 */

import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { HealthController, healthModule } from '@forinda/kickjs'

import { createTestApp, createTestModule } from '../src/index'

const EmptyModule = createTestModule({ register: () => {}, routes: () => null })

describe('the built-in health module', () => {
  it('is a controller, so a spec generator can find its routes', () => {
    // The point of the move. A raw `http.route()` has no class to scan.
    const routes = healthModule().routes?.() as { controller?: unknown; path?: string }
    expect(routes?.controller).toBe(HealthController)
    expect(routes?.path).toBe('/health')
  })

  it('mounts at the root, not under the API prefix', async () => {
    // An orchestrator is configured against `/health/ready`. If the path moved
    // with `apiPrefix` or the API version, an unrelated change would break
    // every probe.
    const { app } = await createTestApp({ modules: [EmptyModule], isolated: true })
    const agent = request(app.handle.bind(app))
    expect((await agent.get('/health/live')).status).toBe(200)
    expect((await agent.get('/api/v1/health/live')).status).toBe(404)
  })

  it('is registered automatically', async () => {
    const { app } = await createTestApp({ modules: [EmptyModule], isolated: true })
    expect((await request(app.handle.bind(app)).get('/health/ready')).status).toBe(200)
  })

  it('is skipped entirely with health: false', async () => {
    const { app } = await createTestApp({
      modules: [EmptyModule],
      health: false,
      isolated: true,
    })
    const agent = request(app.handle.bind(app))
    expect((await agent.get('/health/live')).status).toBe(404)
    expect((await agent.get('/health/ready')).status).toBe(404)
  })

  it('depends only on the probe contract, not on Application internals', async () => {
    // Constructed directly with a fake: the controller reads `isDraining` and
    // `checks` and nothing else, so a replacement module can satisfy the same
    // token. Asserted here rather than by rebinding on a booted app — the
    // controller is built during setup, so a later rebind would not be seen and
    // the test would pass for the wrong reason.
    const controller = new HealthController({
      isDraining: () => false,
      checks: async () => [{ name: 'db', status: 'down' as const }],
    })
    const res = (await controller.ready()) as { status: number; body: unknown }
    expect(res.status).toBe(503)
    expect(res.body).toMatchObject({ status: 'degraded', checks: [{ name: 'db', status: 'down' }] })
  })

  it('reports draining through the same contract', async () => {
    const controller = new HealthController({ isDraining: () => true, checks: async () => [] })
    const live = controller.live() as { status: number; body: { status: string } }
    expect(live.status).toBe(503)
    expect(live.body.status).toBe('draining')
  })
})
