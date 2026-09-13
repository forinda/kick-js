/**
 * SocketIoAdapter against a real HTTP server and real socket.io-client
 * connections, serving ordinary `@WsController` classes.
 *
 * @module @forinda/kickjs-ws/__tests__/socket-io.test
 */
import 'reflect-metadata'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { io as connectClient, type Socket as ClientSocket } from 'socket.io-client'
import Redis from 'ioredis'
import { createAdapter } from '@socket.io/redis-adapter'
import { Container } from '@forinda/kickjs'
import { WsController, OnConnect, OnMessage, WS_USER_BROADCASTER } from '@forinda/kickjs-ws'
import { SocketIoAdapter, SOCKET_IO, type SocketIoContext } from '../src/socket-io'

const seen: string[] = []

@WsController('/chat')
class ChatController {
  @OnConnect()
  connect(ctx: SocketIoContext) {
    seen.push('chat:connect')
    ctx.join('lobby')
  }

  @OnMessage('echo')
  echo(ctx: SocketIoContext) {
    ctx.send('echo', ctx.data)
  }

  @OnMessage('room')
  room(ctx: SocketIoContext) {
    ctx.to('lobby').send('room', ctx.data)
  }

  @OnMessage('others')
  others(ctx: SocketIoContext) {
    ctx.broadcast('others', ctx.data)
  }

  @OnMessage('all')
  all(ctx: SocketIoContext) {
    ctx.broadcastAll('all', ctx.data)
  }

  @OnMessage('*')
  unknown(ctx: SocketIoContext) {
    ctx.send('unknown', ctx.event)
  }
}

@WsController('/alerts')
class AlertsController {}

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
void ChatController
void AlertsController
void SlowController

const cleanups: Array<() => unknown> = []
beforeEach(() => {
  seen.length = 0
  Container.reset()
})
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!()
})

async function boot(options: Record<string, unknown> = {}) {
  const server = http.createServer()
  const adapter = SocketIoAdapter(options as any) as any
  await adapter.beforeStart({ container: Container.getInstance() })
  await adapter.afterStart({ server })
  await new Promise<void>((resolve) => server.listen(0, resolve))
  const port = (server.address() as AddressInfo).port
  cleanups.push(async () => {
    await adapter.shutdown()
    server.close()
  })
  return { server, adapter, origin: `http://127.0.0.1:${port}` }
}

/** A client that records every `event:data` it receives. */
async function client(url: string, query: Record<string, string> = {}) {
  const socket: ClientSocket = connectClient(url, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    query,
  })
  const got: string[] = []
  socket.onAny((event, data) => got.push(`${event}:${data}`))
  cleanups.push(() => socket.disconnect())
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve())
    socket.once('connect_error', reject)
  })
  return { socket, got }
}

async function waitFor(check: () => boolean, ms = 2000): Promise<void> {
  const until = Date.now() + ms
  while (!check()) {
    if (Date.now() > until) throw new Error('condition not met in time')
    await new Promise((r) => setTimeout(r, 10))
  }
}
const settle = () => new Promise((r) => setTimeout(r, 100))

const userFromQuery = {
  resolveUser: (req: http.IncomingMessage) => {
    const id = new URL(req.url!, 'http://x').searchParams.get('user')
    return id ? { id } : null
  },
}

describe('SocketIoAdapter routing', () => {
  it('routes emits to @OnMessage handlers and replies with ctx.send', async () => {
    const { origin } = await boot()
    const a = await client(`${origin}/chat`)
    a.socket.emit('echo', 'hi')
    a.socket.emit('nope', 1)
    await waitFor(() => a.got.length === 2)
    expect(a.got).toEqual(['echo:hi', 'unknown:nope'])
  })

  it('to(room) and broadcastAll include the sender; broadcast skips it', async () => {
    const { origin } = await boot()
    const a = await client(`${origin}/chat`)
    const b = await client(`${origin}/chat`)
    await waitFor(() => seen.filter((s) => s === 'chat:connect').length === 2)
    await settle()

    a.socket.emit('room', 'r')
    a.socket.emit('others', 'o')
    a.socket.emit('all', 'x')
    await waitFor(() => b.got.length === 3)
    await settle()
    expect(a.got).toEqual(['room:r', 'all:x'])
    expect(b.got).toEqual(['room:r', 'others:o', 'all:x'])
  })

  it('holds events until an async @OnConnect settles', async () => {
    const { origin } = await boot()
    const s = await client(`${origin}/slow`)
    s.socket.emit('ping')
    await waitFor(() => seen.includes('slow:ping'))
    expect(seen).toEqual(['slow:connect:start', 'slow:connect:end', 'slow:ping'])
  })
})

describe('SocketIoAdapter auth', () => {
  it('rejects with connect_error "Unauthorized" and never runs @OnConnect', async () => {
    const { origin } = await boot({ auth: userFromQuery })
    const socket = connectClient(`${origin}/chat`, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    })
    cleanups.push(() => socket.disconnect())
    const err = await new Promise<Error>((resolve) => socket.once('connect_error', resolve))
    expect(err.message).toBe('Unauthorized')
    expect(seen).not.toContain('chat:connect')
  })

  it('WS_USER_BROADCASTER reaches the user in every namespace', async () => {
    const { origin } = await boot({ auth: userFromQuery })
    const chat = await client(`${origin}/chat`, { user: 'alice' })
    const alerts = await client(`${origin}/alerts`, { user: 'alice' })
    const bob = await client(`${origin}/chat`, { user: 'bob' })
    await settle()

    Container.getInstance().resolve(WS_USER_BROADCASTER).broadcastToUser('alice', 'ping', 1)
    await waitFor(() => chat.got.length === 1 && alerts.got.length === 1)
    await settle()
    expect([chat.got, alerts.got, bob.got]).toEqual([['ping:1'], ['ping:1'], []])
  })
})

describe('SocketIoAdapter lifecycle', () => {
  it('registers SOCKET_IO and shuts down without closing the HTTP server', async () => {
    const { server, adapter } = await boot()
    expect(Container.getInstance().resolve(SOCKET_IO)).toBeDefined()
    await adapter.shutdown()
    expect(server.listening).toBe(true)
  })
})

const REDIS_URL = process.env.REDIS_URL
describe.skipIf(!REDIS_URL)('SocketIoAdapter across instances (@socket.io/redis-adapter)', () => {
  it('delivers room and per-user emits to sockets on another instance', async () => {
    const adapterFor = () => {
      const pub = new Redis(REDIS_URL!)
      const sub = pub.duplicate()
      cleanups.push(() => {
        pub.disconnect()
        sub.disconnect()
      })
      return createAdapter(pub, sub, { key: `kickjs-test-${process.pid}` })
    }
    const one = await boot({ auth: userFromQuery, adapter: adapterFor() })
    const two = await boot({ auth: userFromQuery, adapter: adapterFor() })
    const alice = await client(`${one.origin}/chat`, { user: 'alice' })
    const bob = await client(`${two.origin}/chat`, { user: 'bob' })
    await settle()

    bob.socket.emit('room', 'from-two')
    await waitFor(() => alice.got.includes('room:from-two'))

    // The last boot registered WS_USER_BROADCASTER, so this is instance two's.
    Container.getInstance().resolve(WS_USER_BROADCASTER).broadcastToUser('alice', 'dm', 'hi')
    await waitFor(() => alice.got.includes('dm:hi'))
  })
})
