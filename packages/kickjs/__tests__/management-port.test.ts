import 'reflect-metadata'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { Container, Controller, Get, type RequestContext } from '../src/index'
import { Application } from '../src/http/application'
import { fastifyRuntime } from '../src/http/runtimes/fastify'
import { h3Runtime } from '../src/http/runtimes/h3'
import { expressRuntime } from '../src/http/runtimes/express'
import { createTestModule } from '@forinda/kickjs-testing'
import type { AppAdapter, KickServer } from '../src/core'

@Controller()
class PingController {
  @Get('/')
  ping(ctx: RequestContext) {
    ctx.json({ pong: true })
  }
}

const runtimes = [
  ['express', () => expressRuntime()],
  ['fastify', () => fastifyRuntime()],
  ['h3', () => h3Runtime()],
] as const

describe.each(runtimes)('management port on %s', (_name, runtime) => {
  let app: Application | undefined
  afterEach(async () => {
    await app?.shutdown()
    app = undefined
  })

  it('serves health and adapter routes on its own port, apart from the app', async () => {
    Container.reset()
    const seen: { server?: KickServer; management?: KickServer } = {}
    const adapter: AppAdapter = {
      name: 'Probe',
      beforeMount({ management }) {
        management!.http.route('GET', '/_probe', (ctx) => ctx.json({ on: 'management' }))
      },
      afterStart({ server, management }) {
        seen.server = server
        seen.management = management?.server
      },
    }
    const module = createTestModule({
      register: (c) => c.register(PingController, PingController),
      routes: () => ({ path: '/ping', controller: PingController }),
    })
    app = new Application({
      modules: [module],
      adapters: [adapter],
      runtime: runtime(),
      port: 0,
      management: { port: 0, host: '127.0.0.1' },
    })
    await app.start()

    const url = (server: KickServer | undefined, path: string) =>
      `http://127.0.0.1:${(server!.address() as AddressInfo).port}${path}`
    const main = (path: string) => fetch(url(seen.server, path))
    const mgmt = (path: string) => fetch(url(seen.management, path))

    expect(seen.management).toBeDefined()
    expect(seen.management).not.toBe(seen.server)
    expect((await main('/api/v1/ping')).status).toBe(200)
    expect((await main('/health/live')).status).toBe(404)
    expect((await main('/_probe')).status).toBe(404)

    expect((await mgmt('/health/live')).status).toBe(200)
    expect(await (await mgmt('/health/ready')).json()).toMatchObject({ status: 'ready' })
    expect(await (await mgmt('/_probe')).json()).toEqual({ on: 'management' })
    expect((await mgmt('/api/v1/ping')).status).toBe(404)

    await app.shutdown()
    app = undefined
    expect(seen.management!.listening).toBe(false)
  })
})
