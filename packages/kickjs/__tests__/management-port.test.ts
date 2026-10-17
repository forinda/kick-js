import 'reflect-metadata'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import https from 'node:https'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  Container,
  Controller,
  Get,
  Logger,
  metricsAdapter,
  requestScopeMiddleware,
  type HttpRuntime,
  type RequestContext,
} from '../src/index'
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
  // The default runtime, which loads Express during setup.
  ['default', () => undefined],
  ['express', () => expressRuntime()],
  ['fastify', () => fastifyRuntime()],
  ['h3', () => h3Runtime()],
] as const

describe.each(runtimes)('management port on %s', (_name, runtime) => {
  let app: Application | undefined
  afterEach(async () => {
    await app?.shutdown()
    app = undefined
    Logger.resetProvider()
  })

  it('serves health and adapter routes on its own port, apart from the app', async () => {
    Container.reset()
    const lines: string[] = []
    const capture = (msg: string) => void lines.push(String(msg))
    const quiet = () => {}
    Logger.setProvider({
      info: capture,
      warn: quiet,
      error: quiet,
      debug: quiet,
      child: () => ({
        info: capture,
        warn: quiet,
        error: quiet,
        debug: quiet,
        child: () => ({}) as any,
      }),
    })
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
      adapters: [adapter, metricsAdapter({ management: true })],
      logRouteTable: true,
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
    expect((await mgmt('/metrics')).status).toBe(200)
    expect((await main('/metrics')).status).toBe(404)
    expect(lines.find((l) => l.includes('HealthController'))).toContain('[management port]')
    expect(lines.find((l) => l.includes('PingController'))).not.toContain('[management port]')

    expect(app.getManagementServer()).toBe(seen.management)

    await app.shutdown()
    expect(app.getManagementServer()).toBeNull()
    app = undefined
    expect(seen.management!.listening).toBe(false)
  })
})

describe('management port details', () => {
  let app: Application | undefined
  afterEach(async () => {
    await app?.shutdown()
    app = undefined
  })

  it('is not ready until the app has started, has its own request scope, and closes its app', async () => {
    Container.reset()
    const base = h3Runtime()
    const closed: unknown[] = []
    // The same runtime, recording which apps it is asked to close.
    const runtime = new Proxy(base, {
      get: (target, key, receiver) =>
        key === 'close'
          ? (engineApp: unknown) => {
              closed.push(engineApp)
              return target.close?.(engineApp)
            }
          : Reflect.get(target, key, receiver),
    }) as HttpRuntime
    let readyWhileStarting: unknown
    let management: KickServer | undefined
    const adapter: AppAdapter = {
      name: 'Probe',
      beforeMount({ management: m }) {
        m!.http.route('GET', '/_scoped', (ctx) => {
          ctx.set('who' as never, 'management' as never)
          ctx.json({ who: ctx.get('who' as never) })
        })
      },
      async afterStart({ management: m }) {
        management = m!.server
        const port = (management!.address() as AddressInfo).port
        // afterStart runs before start() resolves: still starting.
        const res = await fetch(`http://127.0.0.1:${port}/health/ready`)
        readyWhileStarting = { status: res.status, body: await res.json() }
      },
    }
    app = new Application({
      modules: [],
      adapters: [adapter],
      // The app mounts its own request scope; the management app still has one.
      middlewares: [requestScopeMiddleware()],
      runtime,
      port: 0,
      management: { port: 0, host: '127.0.0.1' },
    })
    await app.start()
    const port = (management!.address() as AddressInfo).port

    expect(readyWhileStarting).toEqual({ status: 503, body: { status: 'starting', checks: [] } })
    expect((await fetch(`http://127.0.0.1:${port}/health/ready`)).status).toBe(200)
    expect(await (await fetch(`http://127.0.0.1:${port}/_scoped`)).json()).toEqual({
      who: 'management',
    })

    await app.shutdown()
    app = undefined
    expect(closed).toHaveLength(2)
    expect(closed[0]).not.toBe(closed[1])
  })

  it('closes the management listener when startup fails after it opened', async () => {
    Container.reset()
    let management: KickServer | undefined
    const failing = new Application({
      modules: [],
      adapters: [{ name: 'Spy', afterStart: ({ management: m }) => void (management = m!.server) }],
      plugins: [
        {
          name: 'Broken',
          onReady: async () => {
            throw new Error('not ready')
          },
        },
      ],
      runtime: h3Runtime(),
      port: 0,
      management: { port: 0, host: '127.0.0.1' },
    })
    await expect(failing.start()).rejects.toThrow('not ready')
    expect(management).toBeDefined()
    expect(management!.listening).toBe(false)
    await failing.shutdown()
  })

  const hasOpenssl = (() => {
    try {
      execFileSync('openssl', ['version'], { stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  })()

  it.skipIf(!hasOpenssl)('serves HTTPS with management.tls', async () => {
    Container.reset()
    const dir = mkdtempSync(join(tmpdir(), 'kick-mgmt-tls-'))
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '1',
        '-subj',
        '/CN=localhost',
      ].concat(['-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')]),
      { stdio: 'ignore' },
    )
    const tls = {
      key: readFileSync(join(dir, 'key.pem')),
      cert: readFileSync(join(dir, 'cert.pem')),
    }
    let management: KickServer | undefined
    app = new Application({
      modules: [],
      adapters: [{ name: 'Spy', afterStart: ({ management: m }) => void (management = m!.server) }],
      runtime: h3Runtime(),
      port: 0,
      management: { port: 0, host: '127.0.0.1', tls },
    })
    await app.start()
    const port = (management!.address() as AddressInfo).port
    const status = await new Promise<number>((resolve, reject) => {
      https
        .get(
          { host: '127.0.0.1', port, path: '/health/live', rejectUnauthorized: false },
          (res) => {
            res.resume()
            resolve(res.statusCode!)
          },
        )
        .on('error', reject)
    })
    expect(status).toBe(200)
  })
})
