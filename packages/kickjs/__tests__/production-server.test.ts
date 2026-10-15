import 'reflect-metadata'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type http from 'node:http'
import { Application, Container } from '../src/index'

let app: Application | undefined

beforeEach(() => {
  Container.reset()
})
afterEach(async () => {
  await app?.shutdown()
  app = undefined
})

const urlOf = (a: Application) => {
  const address = (a.getHttpServer() as http.Server).address()
  if (!address || typeof address === 'string') throw new Error('not listening')
  return `http://127.0.0.1:${address.port}`
}

describe('production server', () => {
  it('sets keep-alive and header timeouts above common load balancer idle timeouts', async () => {
    app = new Application({ modules: [], port: 0 })
    await app.start()
    const server = app.getHttpServer() as http.Server
    expect(server.keepAliveTimeout).toBe(65_000)
    expect(server.headersTimeout).toBe(66_000)
    expect(server.requestTimeout).toBe(300_000)
  })

  it('takes explicit timeouts', async () => {
    app = new Application({
      modules: [],
      port: 0,
      server: { keepAliveTimeout: 10_000, requestTimeout: 0 },
    })
    await app.start()
    const server = app.getHttpServer() as http.Server
    expect(server.keepAliveTimeout).toBe(10_000)
    expect(server.headersTimeout).toBe(11_000)
    expect(server.requestTimeout).toBe(0)
  })

  it('keeps serving through preStopDelay, with readiness already 503', async () => {
    // A wide window: under a loaded CI machine the probes below must still land
    // inside it. The test only waits as long as the delay actually takes.
    app = new Application({ modules: [], port: 0, preStopDelay: 1500, shutdownTimeout: 0 })
    await app.start()
    const base = urlOf(app)

    const shutdown = app.shutdown()
    await new Promise((r) => setTimeout(r, 20))

    const ready = await fetch(`${base}/health/ready`)
    expect(ready.status).toBe(503)
    const live = await fetch(`${base}/health/live`)
    expect(live.status).toBe(200)
    expect((await live.json()).status).toBe('draining')

    await shutdown
    app = undefined
    await expect(fetch(`${base}/health/live`)).rejects.toThrow()
  })
})
