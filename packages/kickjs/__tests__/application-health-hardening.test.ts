import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { Application, Container, type AppAdapter } from '../src/index'

beforeEach(() => {
  Container.reset()
})

// x-powered-by disable + trust proxy moved into runtime.createApp(); the
// /health/* routes moved onto the ctx.http facade (M2e). These assert the
// behavior is unchanged after that move.
describe('hardened defaults + health endpoints (via the runtime)', () => {
  it('disables x-powered-by and serves /health/live through the facade', async () => {
    const app = new Application({ modules: [] })
    await app.setup()
    const http = app.getExpressApp()

    const res = await request(http).get('/health/live').expect(200)
    expect(res.body).toEqual({ status: 'ok', uptime: expect.any(Number) })
    expect(res.headers['x-powered-by']).toBeUndefined()
  })

  it('serves /health/ready and reflects adapter onHealthCheck results', async () => {
    const upAdapter: AppAdapter = {
      name: 'UpAdapter',
      onHealthCheck: async () => ({ name: 'UpAdapter', status: 'up' }),
    }
    const app = new Application({ modules: [], adapters: [upAdapter] })
    await app.setup()

    const res = await request(app.getExpressApp()).get('/health/ready').expect(200)
    expect(res.body.status).toBe('ready')
    expect(res.body.checks).toContainEqual({ name: 'UpAdapter', status: 'up' })
  })

  it('returns 503 from /health/ready when an adapter reports down', async () => {
    const downAdapter: AppAdapter = {
      name: 'DownAdapter',
      onHealthCheck: async () => ({ name: 'DownAdapter', status: 'down' }),
    }
    const app = new Application({ modules: [], adapters: [downAdapter] })
    await app.setup()

    const res = await request(app.getExpressApp()).get('/health/ready').expect(503)
    expect(res.body.status).toBe('degraded')
  })

  it('counts a check that does not answer in time as down, without hanging the probe', async () => {
    const hung: AppAdapter = {
      name: 'Hung',
      onHealthCheck: () => new Promise(() => {}),
    }
    const throws: AppAdapter = {
      name: 'Throws',
      onHealthCheck: () => {
        throw new Error('sync')
      },
    }
    const app = new Application({
      modules: [],
      adapters: [hung, throws],
      health: { checkTimeout: 50 },
    })
    await app.setup()

    const started = Date.now()
    const res = await request(app.getExpressApp()).get('/health/ready').expect(503)
    expect(Date.now() - started).toBeLessThan(1000)
    expect(res.body.checks).toEqual([
      { name: 'Hung', status: 'down', reason: 'timeout' },
      { name: 'Throws', status: 'down', reason: 'error' },
    ])
  })

  it('shares one run between probes within a second', async () => {
    let runs = 0
    const counted: AppAdapter = {
      name: 'Counted',
      onHealthCheck: async () => {
        runs++
        return { name: 'Counted', status: 'up' }
      },
    }
    const app = new Application({ modules: [], adapters: [counted] })
    await app.setup()

    await request(app.getExpressApp()).get('/health/ready').expect(200)
    await request(app.getExpressApp()).get('/health/ready').expect(200)
    expect(runs).toBe(1)
  })
})
