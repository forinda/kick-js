/** Every route the app serves is in getRoutes(), with where it's served — adapter routes too. */
import 'reflect-metadata'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Container, Controller, Get, Logger, type RequestContext } from '../src/index'
import { Application, describeRoutes, type MountedRouteInfo } from '../src/http/application'
import { h3Runtime } from '../src/http/runtimes/h3'
import { createTestModule } from '@forinda/kickjs-testing'
import type { AppAdapter } from '../src/core'

@Controller()
class PingController {
  @Get('/')
  ping(ctx: RequestContext) {
    ctx.json({ pong: true })
  }
}

function build(withManagement: boolean, spy: string[] = []) {
  Container.reset()
  const probe: AppAdapter = {
    name: 'Probe',
    beforeMount({ http, management }) {
      http.route('GET', '/probe', (ctx) => ctx.json({}))
      http.serveStatic('/static', mkdtempSync(join(tmpdir(), 'kick-inv-')))
      management?.http.route('GET', '/internal', (ctx) => ctx.json({}))
    },
    onRouteMount(controller) {
      spy.push(controller.name)
    },
  }
  return new Application({
    modules: [
      createTestModule({
        register: (c) => c.register(PingController, PingController),
        routes: () => ({ path: '/ping', controller: PingController }),
      }),
    ],
    adapters: [probe],
    runtime: h3Runtime(),
    port: 0,
    ...(withManagement ? { management: { port: 0, host: '127.0.0.1' } } : {}),
  })
}

const pick = (routes: readonly MountedRouteInfo[]) =>
  routes.map(({ method, pattern, controller, source, port }) => ({
    method,
    pattern,
    controller,
    source,
    port,
  }))

describe('the route inventory', () => {
  let app: Application | undefined
  afterEach(async () => {
    await app?.shutdown()
    app = undefined
    Logger.resetProvider()
  })

  it('lists module and adapter routes, with the port each is on', async () => {
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
    const spy: string[] = []
    app = build(true, spy)
    await app.start()

    expect(pick(app.getRoutes())).toEqual(
      expect.arrayContaining([
        { method: 'GET', pattern: '/probe', controller: 'Probe', source: 'adapter', port: 'app' },
        {
          method: 'GET',
          pattern: '/static/*',
          controller: 'Probe',
          source: 'adapter',
          port: 'app',
        },
        {
          method: 'GET',
          pattern: '/internal',
          controller: 'Probe',
          source: 'adapter',
          port: 'management',
        },
        {
          method: 'GET',
          pattern: '/api/v1/ping',
          controller: 'PingController',
          source: 'module',
          port: 'app',
        },
        {
          method: 'GET',
          pattern: '/health/live',
          controller: 'HealthController',
          source: 'module',
          port: 'management',
        },
      ]),
    )

    // The startup log says what the management port serves.
    const at = lines.findIndex((l) => l.startsWith('Management server on'))
    const listed = lines.slice(at + 1, at + 3).join('\n')
    expect(listed).toMatch(/Probe\s+GET \/internal/)
    expect(listed).toMatch(/HealthController\s+GET \/health\/live, GET \/health\/ready/)

    // A spec built from onRouteMount describes the app's port only.
    expect(spy).toContain('PingController')
    expect(spy).not.toContain('HealthController')
  })

  it('reports the health routes to onRouteMount when they are on the app port', async () => {
    const spy: string[] = []
    app = build(false, spy)
    await app.start()
    expect(spy).toContain('HealthController')
    expect(app.getRoutes().every((r) => r.port === 'app')).toBe(true)
  })
})

describe('describeRoutes', () => {
  it('lists a few routes, and counts many under their common prefix', () => {
    const route = (controller: string, pattern: string): MountedRouteInfo => ({
      method: 'GET',
      pattern,
      controller,
      handler: '',
      contributors: [],
      source: 'adapter',
      port: 'management',
    })
    expect(
      describeRoutes([
        route('MetricsAdapter', '/metrics'),
        ...['/routes', '/container', '/health', '/state', '/config'].map((p) =>
          route('DevToolsAdapter', `/_debug${p}`),
        ),
      ]),
    ).toEqual(['MetricsAdapter   GET /metrics', 'DevToolsAdapter  5 routes under /_debug'])
  })
})
