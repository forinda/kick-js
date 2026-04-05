import 'reflect-metadata'
import http from 'node:http'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import express from 'express'
import { Container, Controller, Get, buildRoutes, RequestContext } from '../src/index'
import { Application } from '../src/http/application'
import { createTestApp, createTestModule } from '@forinda/kickjs-testing'
import type { AppAdapter } from '../src/core'

// ── Fixtures ──────────────────────────────────────────────────────────

@Controller('/slow')
class SlowController {
  @Get('/')
  async slow(ctx: RequestContext) {
    // Simulate a slow request that takes time to complete
    await new Promise((resolve) => setTimeout(resolve, 200))
    ctx.json({ done: true })
  }
}

@Controller('/fast')
class FastController {
  @Get('/')
  fast(ctx: RequestContext) {
    ctx.json({ ok: true })
  }
}

function createSlowModule() {
  return createTestModule({
    register: (c) => {
      c.register(SlowController, SlowController)
    },
    routes: () => ({
      path: '/slow',
      router: buildRoutes(SlowController),
      controller: SlowController,
    }),
  })
}

function createFastModule() {
  return createTestModule({
    register: (c) => {
      c.register(FastController, FastController)
    },
    routes: () => ({
      path: '/fast',
      router: buildRoutes(FastController),
      controller: FastController,
    }),
  })
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('Graceful shutdown with request draining', () => {
  beforeEach(() => {
    Container.reset()
  })

  it('shutdown waits for in-flight requests to complete', async () => {
    const app = new Application({
      modules: [createSlowModule()],
      middleware: [express.json()],
      shutdownTimeout: 5000,
    })
    await app.setup()

    const server = http.createServer(app.getExpressApp())
    await new Promise<void>((resolve) => server.listen(0, resolve))

    const addr = server.address() as { port: number }

    // Start a slow request (200ms)
    const reqPromise = fetch(`http://localhost:${addr.port}/api/v1/slow/`).then((r) => r.json())

    // Give the request a moment to be received by the server
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Verify in-flight tracking
    expect(app.inFlightRequests).toBeGreaterThanOrEqual(1)

    // Start shutdown while request is in-flight
    const shutdownPromise = app.shutdown()

    // The slow request should still complete successfully
    const result = await reqPromise
    expect(result).toEqual({ done: true })

    // Shutdown should complete after request finishes
    await shutdownPromise
    expect(app.isDraining).toBe(true)
    expect(app.inFlightRequests).toBe(0)
  })

  it('shutdown force-closes after timeout', async () => {
    // Create a module with a route that never responds
    let hangReceived = false
    const HangModule = createTestModule({
      register: () => {},
      routes: () => null,
    })

    const app = new Application({
      modules: [HangModule],
      middleware: [
        express.json(),
        // Add a route inline that will never finish
        ((_req: any, res: any, next: any) => {
          if (_req.path === '/hang') {
            hangReceived = true
            // Intentionally never respond
            return
          }
          next()
        }) as any,
      ],
      shutdownTimeout: 50, // Very short timeout
    })
    await app.setup()

    const expressApp = app.getExpressApp()
    const server = http.createServer(expressApp)
    await new Promise<void>((resolve) => server.listen(0, resolve))

    const addr = server.address() as { port: number }

    // Start a request that will never finish
    const abortCtrl = new AbortController()
    fetch(`http://localhost:${addr.port}/hang`, { signal: abortCtrl.signal }).catch(() => {})

    // Wait for the request to be received
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(hangReceived).toBe(true)
    expect(app.inFlightRequests).toBeGreaterThanOrEqual(1)

    // Shutdown should complete after timeout even though request is stuck
    await app.shutdown()

    expect(app.isDraining).toBe(true)

    // Cleanup: abort the hanging request and force-close the server
    abortCtrl.abort()
    server.closeAllConnections()
  })

  it('adapter shutdown hooks are called', async () => {
    const shutdownFn = vi.fn().mockResolvedValue(undefined)
    const adapter: AppAdapter = {
      name: 'TestAdapter',
      shutdown: shutdownFn,
    }

    Container.reset()
    const app = new Application({
      modules: [],
      adapters: [adapter],
      middleware: [express.json()],
    })
    await app.setup()

    await app.shutdown()

    expect(shutdownFn).toHaveBeenCalledTimes(1)
  })

  it('multiple adapter shutdown hooks are all called even if one fails', async () => {
    const shutdown1 = vi.fn().mockRejectedValue(new Error('adapter 1 failed'))
    const shutdown2 = vi.fn().mockResolvedValue(undefined)

    const adapter1: AppAdapter = { name: 'Adapter1', shutdown: shutdown1 }
    const adapter2: AppAdapter = { name: 'Adapter2', shutdown: shutdown2 }

    Container.reset()
    const app = new Application({
      modules: [],
      adapters: [adapter1, adapter2],
      middleware: [express.json()],
    })
    await app.setup()

    // Should not throw even though adapter1 fails
    await app.shutdown()

    expect(shutdown1).toHaveBeenCalledTimes(1)
    expect(shutdown2).toHaveBeenCalledTimes(1)
  })

  it('double-shutdown is safe (idempotent)', async () => {
    const shutdownFn = vi.fn().mockResolvedValue(undefined)
    const adapter: AppAdapter = {
      name: 'TestAdapter',
      shutdown: shutdownFn,
    }

    Container.reset()
    const app = new Application({
      modules: [],
      adapters: [adapter],
      middleware: [express.json()],
    })
    await app.setup()

    // Call shutdown twice concurrently
    await Promise.all([app.shutdown(), app.shutdown()])

    // Adapter shutdown should only be called once
    expect(shutdownFn).toHaveBeenCalledTimes(1)
  })

  it('isDraining is false before shutdown and true after', async () => {
    Container.reset()
    const app = new Application({
      modules: [],
      middleware: [express.json()],
    })
    await app.setup()

    expect(app.isDraining).toBe(false)
    await app.shutdown()
    expect(app.isDraining).toBe(true)
  })

  it('health endpoints return 503 when draining', async () => {
    Container.reset()
    const { expressApp, app } = await createTestApp({ modules: [] })

    // Health endpoints work normally before shutdown
    const liveRes = await request(expressApp).get('/health/live')
    expect(liveRes.status).toBe(200)
    expect(liveRes.body.status).toBe('ok')

    const readyRes = await request(expressApp).get('/health/ready')
    expect(readyRes.status).toBe(200)
    expect(readyRes.body.status).toBe('ready')

    // Trigger shutdown (without a server, it just sets draining state)
    await app.shutdown()

    // Health endpoints should now return 503
    const drainingLive = await request(expressApp).get('/health/live')
    expect(drainingLive.status).toBe(503)
    expect(drainingLive.body.status).toBe('draining')

    const drainingReady = await request(expressApp).get('/health/ready')
    expect(drainingReady.status).toBe(503)
    expect(drainingReady.body.status).toBe('draining')
  })

  it('in-flight request counter tracks requests correctly', async () => {
    Container.reset()
    const { expressApp, app } = await createTestApp({ modules: [createFastModule()] })

    expect(app.inFlightRequests).toBe(0)

    // Make a request and verify counter returns to 0 after completion
    await request(expressApp).get('/api/v1/fast/')
    expect(app.inFlightRequests).toBe(0)
  })

  it('SIGTERM triggers shutdown via bootstrap signal handlers', async () => {
    // bootstrap() registers SIGTERM/SIGINT handlers on first call.
    // We verify this by checking the listener count increases.
    const g = globalThis as any
    const prevBootstrapped = g.__kickBootstrapped
    const prevApp = g.__app

    // Reset bootstrap state so it re-registers signal handlers
    g.__kickBootstrapped = false
    g.__app = undefined
    Container.reset()

    const sigtermBefore = process.listeners('SIGTERM').length
    const sigintBefore = process.listeners('SIGINT').length

    const { bootstrap } = await import('../src/http/bootstrap')
    const app = await bootstrap({
      modules: [],
      middleware: [express.json()],
      port: 0,
    })

    expect(process.listeners('SIGTERM').length).toBeGreaterThan(sigtermBefore)
    expect(process.listeners('SIGINT').length).toBeGreaterThan(sigintBefore)

    // Cleanup: close the server so it doesn't keep the test alive
    const server = app.getHttpServer()
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }

    // Restore globals
    g.__kickBootstrapped = prevBootstrapped
    g.__app = prevApp
  })
})
