/**
 * createHandler(() => import('./index')): the function serves the app the
 * entry's own bootstrap() call describes, without that call listening.
 */
import 'reflect-metadata'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  Container,
  Controller,
  Get,
  RequestContext,
  bootstrap,
  createHandler,
  type Application,
  type KickHandler,
} from '../src/index'

const handlers: KickHandler[] = []
beforeEach(() => Container.reset())
afterEach(async () => {
  while (handlers.length) await handlers.pop()!.close()
})

function pingModule() {
  @Controller()
  class PingController {
    @Get('/')
    ping(ctx: RequestContext) {
      ctx.json({ pong: true })
    }
  }
  return { routes: () => ({ path: '/ping', controller: PingController }) } as never
}

describe('createHandler(entry)', () => {
  it('serves the app the entry bootstraps, without listening', async () => {
    const signals = process.listenerCount('SIGTERM')
    let exported: Application | undefined
    // Stands in for `() => import('./index')`, whose module body runs
    // `export const app = await bootstrap({ ... })`.
    const handler = createHandler(async () => {
      exported = await bootstrap({ modules: [pingModule()] })
    })
    handlers.push(handler)

    const res = await handler.fetch(new Request('http://x/api/v1/ping'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ pong: true })
    // The entry's `app` is the one serving, and no port or signal hook was taken.
    expect(await handler.ready()).toBe(exported)
    expect(exported!.getHttpServer?.()).toBeFalsy()
    expect(process.listenerCount('SIGTERM')).toBe(signals)
  })

  it('names the mistake when the entry never calls bootstrap()', async () => {
    let loads = 0
    const handler = createHandler(async () => {
      loads++
    })
    handlers.push(handler)
    await expect(handler.ready()).rejects.toThrow(/without calling bootstrap\(\)/)
    // Not cached: the next request tries the entry again.
    await expect(handler.ready()).rejects.toThrow()
    expect(loads).toBe(2)
  })

  it('leaves bootstrap() alone outside a loading handler', async () => {
    const handler = createHandler(async () => {
      await bootstrap({ modules: [pingModule()] })
    })
    handlers.push(handler)
    await handler.ready()
    expect(
      (globalThis as Record<symbol, unknown>)[Symbol.for('kickjs.handler.entryCapture')],
    ).toBeUndefined()
  })
})
