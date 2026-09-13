/**
 * Cross-instance fan-out: two WsAdapter instances, each on its own HTTP
 * server, joined by a broker. An in-memory hub stands in for pub/sub; the last
 * suite runs the same checks over real Redis when REDIS_URL is set.
 *
 * @module @forinda/kickjs-ws/__tests__/broker.integration.test
 */
import 'reflect-metadata'
import http from 'node:http'
import { EventEmitter } from 'node:events'
import type { AddressInfo } from 'node:net'
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { WebSocket } from 'ws'
import Redis from 'ioredis'
import { Container } from '@forinda/kickjs'
import {
  WsAdapter,
  WsController,
  OnConnect,
  OnMessage,
  type WsBroker,
  type WsBrokerMessage,
  type WsContext,
} from '@forinda/kickjs-ws'
import { redisBroker } from '../src/redis'

@WsController('/chat')
class ChatController {
  @OnConnect()
  connect(ctx: WsContext) {
    ctx.join('lobby')
  }

  @OnMessage('room')
  room(ctx: WsContext) {
    ctx.to('lobby').send('room', ctx.data)
  }

  @OnMessage('others')
  others(ctx: WsContext) {
    ctx.broadcast('others', ctx.data)
  }

  @OnMessage('all')
  all(ctx: WsContext) {
    ctx.broadcastAll('all', ctx.data)
  }
}
void ChatController

const cleanups: Array<() => unknown> = []
beforeEach(() => {
  Container.reset()
})
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!()
})

/** Pub/sub in one process. Round-trips through JSON like a real broker. */
function memoryHub(): () => WsBroker {
  const subscribers: Array<(message: WsBrokerMessage) => void> = []
  return () => ({
    publish(message) {
      for (const deliver of subscribers) deliver(JSON.parse(JSON.stringify(message)))
    },
    subscribe(onMessage) {
      subscribers.push(onMessage)
    },
  })
}

async function instance(options: Record<string, unknown>) {
  const server = http.createServer()
  const adapter = WsAdapter({ heartbeatInterval: 0, ...options }) as any
  await adapter.beforeStart({ container: Container.getInstance() })
  await adapter.afterStart({ server })
  await new Promise<void>((resolve) => server.listen(0, resolve))
  const port = (server.address() as AddressInfo).port
  cleanups.push(async () => {
    await adapter.shutdown()
    server.close()
  })
  return { adapter, url: (path: string) => `ws://127.0.0.1:${port}${path}` }
}

/** A client that records every `event:data` it receives. */
async function client(url: string) {
  const ws = new WebSocket(url)
  const got: string[] = []
  ws.on('message', (raw) => {
    const { event, data } = JSON.parse(String(raw))
    got.push(`${event}:${data}`)
  })
  cleanups.push(() => ws.terminate())
  await new Promise((resolve, reject) => {
    ws.once('open', resolve)
    ws.once('error', reject)
  })
  return {
    ws,
    got,
    send: (event: string, data: string) => ws.send(JSON.stringify({ event, data })),
  }
}

async function waitFor(check: () => boolean, ms = 2000): Promise<void> {
  const until = Date.now() + ms
  while (!check()) {
    if (Date.now() > until) throw new Error('condition not met in time')
    await new Promise((r) => setTimeout(r, 10))
  }
}
const settle = () => new Promise((r) => setTimeout(r, 100))

/** Two instances; `a` and `b` on the first, `c` on the second, all in `lobby`. */
async function cluster(brokerFor: () => WsBroker, options: Record<string, unknown> = {}) {
  const one = await instance({ broker: brokerFor(), ...options })
  const two = await instance({ broker: brokerFor(), ...options })
  const a = await client(one.url('/ws/chat'))
  const b = await client(one.url('/ws/chat'))
  const c = await client(two.url('/ws/chat'))
  await waitFor(
    () => one.adapter.getStats().rooms.lobby === 2 && two.adapter.getStats().rooms.lobby === 1,
  )
  return { one, two, a, b, c }
}

function crossInstanceSuite(name: string, brokerFor: () => () => WsBroker) {
  describe(name, () => {
    it('delivers a room broadcast to members on every instance, once each', async () => {
      const { a, b, c } = await cluster(brokerFor())
      a.send('room', 'hi')
      await waitFor(() => c.got.length === 1)
      await settle()
      expect([a.got, b.got, c.got]).toEqual([['room:hi'], ['room:hi'], ['room:hi']])
    })

    it('ctx.broadcast skips the sender everywhere; broadcastAll includes it', async () => {
      const { a, b, c } = await cluster(brokerFor())
      a.send('others', 'x')
      a.send('all', 'y')
      await waitFor(() => c.got.length === 2)
      await settle()
      expect(a.got).toEqual(['all:y'])
      expect(b.got).toEqual(['others:x', 'all:y'])
      expect(c.got).toEqual(['others:x', 'all:y'])
    })

    it('broadcastToUser from one instance reaches the user on another', async () => {
      const auth = {
        resolveUser: (req: http.IncomingMessage) => ({
          id: new URL(req.url!, 'http://x').searchParams.get('user')!,
        }),
      }
      const make = brokerFor()
      const one = await instance({ broker: make(), auth })
      const two = await instance({ broker: make(), auth })
      const alice = await client(one.url('/ws/chat?user=alice'))
      await waitFor(() => one.adapter.getStats().rooms['user:alice'] === 1)

      two.adapter.broadcastToUser('alice', 'ping', 'from-two')
      await waitFor(() => alice.got.length === 1)
      await settle()
      expect(alice.got).toEqual(['ping:from-two'])
    })
  })
}

crossInstanceSuite('WsAdapter broker (in-memory hub)', () => memoryHub())

describe('WsAdapter broker failures', () => {
  it('logs a failed publish instead of throwing out of the handler', async () => {
    const failing: WsBroker = {
      publish: () => Promise.reject(new Error('redis down')),
      subscribe: () => {},
    }
    const { url } = await instance({ broker: failing })
    const a = await client(url('/ws/chat'))
    const b = await client(url('/ws/chat'))
    await new Promise((r) => setTimeout(r, 30))
    a.send('room', 'still-local')
    await waitFor(() => b.got.length === 1)
    expect(b.got).toEqual(['room:still-local'])
  })
})

describe('redisBroker', () => {
  function fakeRedis() {
    const bus = new EventEmitter()
    const subscriber = Object.assign(bus, {
      subscribe: vi.fn(async () => {}),
      unsubscribe: vi.fn(async () => {}),
    })
    const publisher = {
      publish: vi.fn(async (channel: string, message: string) => {
        bus.emit('message', channel, message)
      }),
    }
    return { publisher, subscriber }
  }

  it('publishes JSON on its channel and ignores other channels and non-JSON', async () => {
    const { publisher, subscriber } = fakeRedis()
    const broker = redisBroker({ publisher: publisher as any, subscriber: subscriber as any })
    const seen: WsBrokerMessage[] = []
    await broker.subscribe((m) => seen.push(m))
    expect(subscriber.subscribe).toHaveBeenCalledWith('kickjs:ws')

    const message = { origin: 'i1', room: 'lobby', event: 'e', data: 1 }
    await broker.publish(message)
    subscriber.emit('message', 'other-app', JSON.stringify(message))
    subscriber.emit('message', 'kickjs:ws', 'not json')
    expect(seen).toEqual([message])

    await broker.close!()
    expect(subscriber.unsubscribe).toHaveBeenCalledWith('kickjs:ws')
    await broker.publish(message)
    expect(seen).toHaveLength(1)
  })
})

const REDIS_URL = process.env.REDIS_URL
describe.skipIf(!REDIS_URL)('WsAdapter broker (real Redis)', () => {
  // One channel per run so a parallel run against the same Redis cannot cross.
  const channel = `kickjs:ws:test:${process.pid}`
  crossInstanceSuite('over ioredis', () => () => {
    const publisher = new Redis(REDIS_URL!)
    const subscriber = publisher.duplicate()
    // Queued before the adapter's own cleanup, so it runs after shutdown has
    // unsubscribed — disconnecting first made `unsubscribe` hit a closed socket.
    cleanups.push(() => {
      publisher.disconnect()
      subscriber.disconnect()
    })
    return redisBroker({ publisher, subscriber, channel })
  })
})
