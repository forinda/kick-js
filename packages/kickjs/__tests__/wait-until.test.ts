/**
 * `waitUntil` — work that outlives its response. Each path that can end a
 * request's life has to wait for it: the Node server's `shutdown()`,
 * `createHandler()` (fetch + node) through the platform hook, and the web
 * entry through the Workers execution context.
 */
import 'reflect-metadata'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as h3v2 from 'h3-v2'
import {
  Container,
  Controller,
  Get,
  RequestContext,
  createHandler,
  settleBackgroundWork,
  waitUntil,
  type KickHandler,
} from '../src/index'
import { Application } from '../src/http/application'
import { pendingBackgroundWork } from '../src/http/background'
import { createFetchHandler } from '../src/web'
import { defineModule } from '../src/core/define-module'

/** A promise the test resolves by hand, plus whether its work ran. */
function deferred() {
  let resolve!: () => void
  const state = { done: false }
  const promise = new Promise<void>((r) => (resolve = r)).then(() => {
    state.done = true
  })
  return { promise, resolve, state }
}

let work: ReturnType<typeof deferred>
const handlers: KickHandler[] = []

beforeEach(() => {
  Container.reset()
  work = deferred()
})

afterEach(async () => {
  work.resolve()
  while (handlers.length) await handlers.pop()!.close()
  await settleBackgroundWork()
})

function backgroundModule() {
  @Controller()
  class JobsController {
    @Get('/')
    kick(ctx: RequestContext) {
      ctx.waitUntil(work.promise)
      ctx.json({ accepted: true })
    }
  }
  return { routes: () => ({ path: '/jobs', controller: JobsController }) }
}

describe('waitUntil()', () => {
  it('settleBackgroundWork waits for registered work, including work added while waiting', async () => {
    const late = deferred()
    waitUntil(work.promise.then(() => waitUntil(late.promise)))
    const settled = settleBackgroundWork()
    work.resolve()
    await Promise.resolve()
    late.resolve()
    await settled
    expect(work.state.done && late.state.done).toBe(true)
    expect(pendingBackgroundWork()).toBe(0)
  })

  it('logs a rejection instead of leaving it unhandled', async () => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      waitUntil(Promise.reject(new Error('boom')))
      await settleBackgroundWork()
      await new Promise((r) => setTimeout(r, 10))
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })
})

describe('Node server shutdown', () => {
  it('waits for ctx.waitUntil work before finishing', async () => {
    const app = new Application({ modules: [backgroundModule() as never], port: 0 })
    await app.start()
    const port = (app.getHttpServer()!.address() as AddressInfo).port
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/jobs`)
    expect(await res.json()).toEqual({ accepted: true })

    let finished = false
    const shutdown = app.shutdown().then(() => (finished = true))
    await new Promise((r) => setTimeout(r, 50))
    expect(finished).toBe(false) // shutdown is still waiting on the work
    work.resolve()
    await shutdown
    expect(work.state.done).toBe(true)
  })

  it('stops waiting at shutdownTimeout', async () => {
    const app = new Application({
      modules: [backgroundModule() as never],
      port: 0,
      shutdownTimeout: 50,
    })
    await app.start()
    const port = (app.getHttpServer()!.address() as AddressInfo).port
    await fetch(`http://127.0.0.1:${port}/api/v1/jobs`)

    const started = Date.now()
    await app.shutdown()
    expect(Date.now() - started).toBeLessThan(1000)
    expect(work.state.done).toBe(false)
  })
})

describe('createHandler()', () => {
  it('fetch hands background work to the platform waitUntil', async () => {
    const handler = createHandler({ modules: [backgroundModule() as never] })
    handlers.push(handler)
    const platform = { waitUntil: vi.fn() }

    const res = await handler.fetch(new Request('http://x/api/v1/jobs'), platform)
    expect(await res.json()).toEqual({ accepted: true })
    expect(platform.waitUntil).toHaveBeenCalledTimes(1)

    const handed = platform.waitUntil.mock.calls[0][0] as Promise<unknown>
    work.resolve()
    await handed
    expect(work.state.done).toBe(true)
  })

  it('node hands the work over after the response has gone out', async () => {
    const handler = createHandler({ modules: [backgroundModule() as never] })
    handlers.push(handler)
    const platform = { waitUntil: vi.fn() }
    const server = http.createServer((req, res) => void handler.node(req, res, platform))
    await new Promise<void>((r) => server.listen(0, r))
    try {
      const port = (server.address() as AddressInfo).port
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/jobs`)
      expect(await res.json()).toEqual({ accepted: true })
      expect(platform.waitUntil).toHaveBeenCalledTimes(1)

      const handed = platform.waitUntil.mock.calls[0][0] as Promise<unknown>
      work.resolve()
      await handed
      expect(work.state.done).toBe(true)
    } finally {
      await new Promise((r) => server.close(r))
    }
  })
})

describe('web entry', () => {
  it('createFetchHandler forwards the Workers execution context', async () => {
    @Controller()
    class JobsController {
      @Get('/')
      kick(ctx: RequestContext) {
        ctx.waitUntil(work.promise)
        ctx.json({ accepted: true })
      }
    }
    const mod = defineModule({
      name: 'JobsModule',
      build: () => ({ routes: () => ({ path: '/jobs', controller: JobsController }) }),
    })
    const handler = createFetchHandler((env) => ({ h3: h3v2, modules: [mod()], env }))
    const ctx = { waitUntil: vi.fn() }

    const res = await handler.fetch(new Request('http://x/api/v1/jobs'), {}, ctx)
    expect(await res.json()).toEqual({ accepted: true })
    expect(ctx.waitUntil).toHaveBeenCalledTimes(1)

    const handed = ctx.waitUntil.mock.calls[0][0] as Promise<unknown>
    work.resolve()
    await handed
    expect(work.state.done).toBe(true)
  })
})
