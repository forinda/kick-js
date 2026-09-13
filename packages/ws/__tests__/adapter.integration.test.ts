/**
 * WsAdapter against a real HTTP server and real `ws` clients.
 *
 * The RoomManager unit tests never exercised the adapter, decorators, auth or
 * upgrade routing — and a note claimed real-server tests could not run in
 * vitest's worker threads. They can; every case below does.
 *
 * @module @forinda/kickjs-ws/__tests__/adapter.integration.test
 */
import 'reflect-metadata'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'
import { Container } from '@forinda/kickjs'
import { WsAdapter, WsController, OnConnect, OnMessage, type WsContext } from '@forinda/kickjs-ws'

const seen: string[] = []

@WsController('/a')
class AController {
  @OnConnect()
  connect(ctx: WsContext) {
    seen.push('a:connect')
    ctx.join('lobby')
    ctx.send('hello', 1)
  }

  @OnMessage('ping')
  ping() {
    seen.push('a:ping')
  }

  @OnMessage('shout')
  shout(ctx: WsContext) {
    ctx.to('lobby').send('shout', 'from-a')
  }
}

@WsController('/b')
class BController {
  @OnConnect()
  connect(ctx: WsContext) {
    ctx.join('lobby')
  }
}
@WsController('/slow')
class SlowController {
  @OnConnect()
  async connect() {
    seen.push('slow:connect:start')
    await new Promise((r) => setTimeout(r, 50))
    seen.push('slow:connect:end')
  }

  @OnMessage('ping')
  ping() {
    seen.push('slow:ping')
  }
}
void AController
void BController
void SlowController

const cleanups: Array<() => void> = []
beforeEach(() => {
  seen.length = 0
})
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

async function boot(options: Record<string, unknown> = {}, after?: (s: http.Server) => void) {
  Container.reset()
  const server = http.createServer()
  const adapter = WsAdapter({ heartbeatInterval: 0, ...options }) as any
  await adapter.beforeStart({ container: Container.getInstance() })
  await adapter.afterStart({ server })
  after?.(server)
  await new Promise<void>((resolve) => server.listen(0, resolve))
  const port = (server.address() as AddressInfo).port
  cleanups.push(() => {
    adapter.shutdown()
    server.close()
  })
  return { url: (path: string) => `ws://127.0.0.1:${port}${path}`, adapter }
}

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    cleanups.push(() => ws.terminate())
    ws.once('open', () => resolve(ws))
    ws.once('error', reject)
  })
}

async function waitFor(check: () => boolean, ms = 1000): Promise<void> {
  const until = Date.now() + ms
  while (!check()) {
    if (Date.now() > until) throw new Error('condition not met in time')
    await new Promise((r) => setTimeout(r, 10))
  }
}

describe('WsAdapter upgrade routing', () => {
  // Node calls every 'upgrade' listener; answering 404 for paths the adapter
  // does not own used to destroy sockets owned by devtools, a GraphQL
  // subscription server or Vite's HMR socket.
  it('leaves an upgrade on a path it does not own to other listeners', async () => {
    const { url } = await boot({}, (server) => {
      const other = new WebSocketServer({ noServer: true })
      server.on('upgrade', (req, socket, head) => {
        if (req.url?.split('?')[0] !== '/_debug/bus') return
        other.handleUpgrade(req, socket, head, () => {})
      })
    })
    await expect(connect(url('/_debug/bus'))).resolves.toBeInstanceOf(WebSocket)
  })

  it('answers 404 for an unknown path when it is the only upgrade listener', async () => {
    const { url } = await boot()
    const status = await new Promise<number>((resolve) => {
      const ws = new WebSocket(url('/ws/nope'))
      cleanups.push(() => ws.terminate())
      ws.once('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0))
      ws.once('error', () => {})
    })
    expect(status).toBe(404)
  })
})

describe('WsAdapter authentication', () => {
  it('delivers messages sent before resolveUser settles, after @OnConnect', async () => {
    const { url } = await boot({
      auth: {
        resolveUser: () => new Promise((r) => setTimeout(() => r({ id: 'u1' }), 50)),
      },
    })
    const ws = await connect(url('/ws/a'))
    ws.send(JSON.stringify({ event: 'ping' }))

    await waitFor(() => seen.includes('a:ping'))
    expect(seen.indexOf('a:connect')).toBeLessThan(seen.indexOf('a:ping'))
  })

  // Without auth too: an async @OnConnect finishing its setup after the first
  // @OnMessage ran was the same race, just without the hold.
  it.each([
    ['without auth', {}],
    ['with auth', { auth: { resolveUser: () => ({ id: 'u1' }) } }],
  ])('delivers messages only after an async @OnConnect settles (%s)', async (_, options) => {
    const { url } = await boot(options)
    const ws = await connect(url('/ws/slow'))
    ws.send(JSON.stringify({ event: 'ping' }))

    await waitFor(() => seen.includes('slow:ping'))
    expect(seen).toEqual(['slow:connect:start', 'slow:connect:end', 'slow:ping'])
  })

  it('closes a rejected socket with 4401 and never runs @OnConnect', async () => {
    const { url } = await boot({ auth: { resolveUser: () => null } })
    const ws = new WebSocket(url('/ws/a'))
    cleanups.push(() => ws.terminate())
    const code = await new Promise<number>((resolve) => ws.once('close', resolve))
    expect(code).toBe(4401)
    expect(seen).not.toContain('a:connect')
  })

  // The sender is unauthenticated while its messages are held, so the hold is
  // capped rather than letting anyone buffer memory on the server.
  it('closes with 1008 when a socket floods before authenticating', async () => {
    const { url } = await boot({
      auth: { resolveUser: () => new Promise((r) => setTimeout(() => r({ id: 'u1' }), 500)) },
    })
    const ws = await connect(url('/ws/a'))
    const closed = new Promise<number>((resolve) => ws.once('close', resolve))
    for (let i = 0; i < 65; i++) ws.send(JSON.stringify({ event: 'ping' }))
    expect(await closed).toBe(1008)
  })

  // A message count alone lets 64 large frames hold 64 × maxPayload.
  it('closes with 1008 when held messages exceed the byte cap', async () => {
    const { url } = await boot({
      auth: { resolveUser: () => new Promise((r) => setTimeout(() => r({ id: 'u1' }), 500)) },
    })
    const ws = await connect(url('/ws/a'))
    const closed = new Promise<number>((resolve) => ws.once('close', resolve))
    const big = JSON.stringify({ event: 'ping', data: 'x'.repeat(600_000) })
    ws.send(big)
    ws.send(big)
    expect(await closed).toBe(1008)
  })

  it('does not run @OnConnect or join the user room when the client leaves mid-auth', async () => {
    const { url, adapter } = await boot({
      auth: { resolveUser: () => new Promise((r) => setTimeout(() => r({ id: 'u1' }), 50)) },
    })
    const ws = await connect(url('/ws/a'))
    ws.send(JSON.stringify({ event: 'ping' }))
    ws.close()
    await new Promise((r) => setTimeout(r, 150))
    expect(seen).toEqual([])
    expect(adapter.getStats().rooms).toEqual({})
  })
})

describe('WsAdapter stats and rooms', () => {
  it('counts frames sent through the context and through rooms', async () => {
    const { url, adapter } = await boot()
    const ws = await connect(url('/ws/a'))
    await waitFor(() => adapter.getStats().messagesSent === 1) // ctx.send('hello')

    ws.send(JSON.stringify({ event: 'shout' }))
    await waitFor(() => adapter.getStats().messagesSent === 2) // lobby: one socket
  })

  // Pinned so a future change to per-namespace rooms is deliberate: services
  // broadcasting through WS_ROOM_MANAGER and `user:<id>` rooms rely on it.
  it('shares room names across namespaces', async () => {
    const { url } = await boot()
    const a = await connect(url('/ws/a'))
    const b = await connect(url('/ws/b'))
    let reached = false
    b.on('message', (m) => {
      if (String(m).includes('from-a')) reached = true
    })
    await waitFor(() => seen.includes('a:connect'))
    await new Promise((r) => setTimeout(r, 30))
    a.send(JSON.stringify({ event: 'shout' }))
    await waitFor(() => reached)
  })
})
