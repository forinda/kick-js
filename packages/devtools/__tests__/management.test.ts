/** `DevToolsAdapter({ management: true })` serves the dashboard on the management port. */
import 'reflect-metadata'
import { afterEach, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import { Application, Container, type AppAdapter, type KickServer } from '@forinda/kickjs'
import { DevToolsAdapter } from '@forinda/kickjs-devtools'

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

    expect((await fetch(at(seen.management))).status).toBe(200)
    expect((await fetch(at(seen.server))).status).toBe(404)
  })
})
