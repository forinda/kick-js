// A dev reload builds a new app on the same http.Server. The dashboard's live
// connection has to come back on it, with the token the new app printed.
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { bootstrap, Container } from '@forinda/kickjs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSocket } from 'ws'
import { DevToolsAdapter } from '../src/index'

const g = globalThis as any

const connect = (port: number, token: string) =>
  new Promise<number>((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/_debug/_bus?token=${token}`)
    ws.once('open', () => {
      ws.close()
      resolve(101)
    })
    ws.once('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0))
    ws.once('error', () => resolve(0))
  })

describe('event bus across a dev reload', () => {
  let server: http.Server

  afterEach(async () => {
    await g.__app?.shutdown({ closeServer: false })
    delete g.__app
    delete g.__kickjs_httpServer
    delete g.__kickjs_container
    delete g.__kickjs_app_shutdown
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
    Container.reset()
  })

  it('accepts the new token after a reload and refuses the old one', async () => {
    server = http.createServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    g.__kickjs_httpServer = server
    const { port } = server.address() as AddressInfo

    const boot = (secret: string) =>
      bootstrap({ modules: [], adapters: [DevToolsAdapter({ enabled: true, secret })] })

    await boot('first')
    expect(await connect(port, 'first')).toBe(101)

    await boot('second')
    expect(await connect(port, 'second')).toBe(101)
    expect(await connect(port, 'first')).toBe(401)
    expect(server.listenerCount('upgrade')).toBe(1)

    await boot('third')
    expect(await connect(port, 'third')).toBe(101)
    expect(server.listenerCount('upgrade')).toBe(1)
  })

  it('keeps a generated token across a reload, so an open dashboard stays connected', async () => {
    server = http.createServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    g.__kickjs_httpServer = server
    const { port } = server.address() as AddressInfo
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const tokens = () =>
      log.mock.calls.flatMap(([line]) => /\[token: (\w+)\]/.exec(String(line))?.[1] ?? [])

    const boot = () => bootstrap({ modules: [], adapters: [DevToolsAdapter({ enabled: true })] })
    await boot()
    await boot()
    const [first, second] = tokens()
    log.mockRestore()

    expect(first).toEqual(expect.any(String))
    expect(second).toBe(first)
    expect(await connect(port, first)).toBe(101)
  })
})
