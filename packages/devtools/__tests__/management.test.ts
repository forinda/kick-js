/** `DevToolsAdapter({ management: true })` serves the dashboard on the management port. */
import 'reflect-metadata'
import { afterEach, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import { Application, Container, type AppAdapter, type KickServer } from '@forinda/kickjs'
import { DevToolsAdapter } from '@forinda/kickjs-devtools'
import { getActiveDevtoolsBus } from '@forinda/kickjs-devtools-kit/bus/token'

let app: Application | undefined
afterEach(async () => {
  await app?.shutdown()
  app = undefined
})

describe('DevTools on the management port', () => {
  it('answers /_debug there and not on the public port', async () => {
    Container.reset()
    const seen: { server?: KickServer; management?: KickServer } = {}
    const spy: AppAdapter = {
      name: 'Spy',
      afterStart({ server, management }) {
        seen.server = server
        seen.management = management?.server
      },
    }
    app = new Application({
      modules: [],
      adapters: [
        DevToolsAdapter({
          enabled: true,
          secret: false,
          management: true,
          runtime: { enabled: false },
        }),
        spy,
      ],
      port: 0,
      management: { port: 0, host: '127.0.0.1' },
    })
    await app.start()
    const at = (server: KickServer | undefined) =>
      `http://127.0.0.1:${(server!.address() as AddressInfo).port}/_debug/health`

    const health = await fetch(at(seen.management))
    expect(health.status).toBe(200)
    expect(await health.json()).toMatchObject({ app: 'ready' })
    expect((await fetch(at(seen.server))).status).toBe(404)

    // The dashboard hears the app's status change as it happens.
    const heard: unknown[] = []
    getActiveDevtoolsBus()!.on('app:status', (payload) => heard.push(payload))
    await app.shutdown()
    app = undefined
    // Through to the end: the bus stays open until 'stopped' has gone out.
    expect(heard).toEqual([{ status: 'draining' }, { status: 'stopped' }])
    expect(getActiveDevtoolsBus()).toBeUndefined()
  })

  it.each([
    ['the app port', false, 'app'],
    ['the management port', true, 'management'],
  ] as const)(
    'lists every route with its port when served on %s',
    async (_where, onManagement, dashboard) => {
      Container.reset()
      let listener: KickServer | undefined
      const probe: AppAdapter = {
        name: 'Probe',
        beforeMount({ http, management }) {
          http.route('GET', '/probe', (ctx) => ctx.json({}))
          management!.http.route('GET', '/internal', (ctx) => ctx.json({}))
        },
        afterStart({ server, management }) {
          listener = onManagement ? management?.server : server
        },
      }
      app = new Application({
        modules: [],
        adapters: [
          DevToolsAdapter({
            enabled: true,
            secret: false,
            management: onManagement,
            runtime: { enabled: false },
          }),
          probe,
        ],
        port: 0,
        management: { port: 0, host: '127.0.0.1' },
      })
      await app.start()
      const res = await fetch(
        `http://127.0.0.1:${(listener!.address() as AddressInfo).port}/_debug/routes`,
      )
      const body = (await res.json()) as {
        port: string
        routes: Array<{ path: string; controller: string; source?: string; port?: string }>
      }

      expect(body.port).toBe(dashboard)
      const pick = ({ path, controller, source, port }: (typeof body.routes)[number]) => ({
        path,
        controller,
        source,
        port,
      })
      expect(body.routes.map(pick)).toEqual(
        expect.arrayContaining([
          { path: '/probe', controller: 'Probe', source: 'adapter', port: 'app' },
          { path: '/internal', controller: 'Probe', source: 'adapter', port: 'management' },
          {
            path: '/health/live',
            controller: 'HealthController',
            source: 'module',
            port: 'management',
          },
        ]),
      )
      // The dashboard's own routes stay out.
      expect(body.routes.some((r) => r.controller === 'DevToolsAdapter')).toBe(false)
    },
  )
})
