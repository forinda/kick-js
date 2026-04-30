// Server-side bus coverage. The hard part is exercising the WS
// upgrade path without a real http.Server — Node's `ws` package
// supports `noServer: true` and a manual `handleUpgrade()`, which is
// exactly what createServerBus uses internally. Tests here:
//
//   1. Local emit + subscribe semantics (delegated to the core, but
//      asserted at the surface layer for regression safety).
//   2. Real client connect/send/receive over a real http.Server +
//      ws Client. End-to-end smoke that the upgrade routing,
//      auth check, and JSON framing are wired correctly.
//   3. Auth gate — wrong/no token returns 401 at handshake.
//   4. Loop avoidance — client emits dispatch locally but DON'T fan
//      out to other clients.
//   5. close() drops listeners and disconnects clients.

import { describe, expect, it, vi, afterEach } from 'vitest'
import http from 'node:http'
import { AddressInfo } from 'node:net'
import { WebSocket } from 'ws'

import { createServerBus, type ServerBus } from '../src/bus/server'

interface Harness {
  bus: ServerBus
  server: http.Server
  port: number
  cleanup: () => Promise<void>
}

const harnesses: Harness[] = []

afterEach(async () => {
  while (harnesses.length > 0) {
    const h = harnesses.pop()!
    await h.cleanup()
  }
})

const startHarness = async (opts: Parameters<typeof createServerBus>[0] = {}): Promise<Harness> => {
  const bus = createServerBus(opts)
  const server = http.createServer((_req, res) => {
    // Plain HTTP responses keep the test server quiet on non-upgrade
    // probes so we don't hang the runner if a request slips through.
    res.statusCode = 404
    res.end()
  })
  bus.attachUpgrade(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  const cleanup = async () => {
    bus.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  const h: Harness = { bus, server, port, cleanup }
  harnesses.push(h)
  return h
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const connectClient = async (port: number, opts: { token?: string; path?: string } = {}) => {
  const path = opts.path ?? '/_debug/_bus'
  const url = opts.token
    ? `ws://127.0.0.1:${port}${path}?token=${encodeURIComponent(opts.token)}`
    : `ws://127.0.0.1:${port}${path}`
  const ws = new WebSocket(url)
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve())
    ws.once('error', (err) => reject(err))
  })
  return ws
}

describe('createServerBus — local emit + subscribe', () => {
  it('on() handler fires on local emit', async () => {
    const { bus } = await startHarness()
    const handler = vi.fn()
    bus.on('local', handler)
    bus.emit('local', { ok: 1 })
    expect(handler).toHaveBeenCalledWith({ ok: 1 })
  })

  it('onAny() sees the full envelope including ts', async () => {
    const { bus } = await startHarness()
    const seen: Array<{ type: string; ts: number }> = []
    bus.onAny((e) => seen.push({ type: e.type, ts: e.ts }))
    bus.emit('event', null)
    expect(seen[0]?.type).toBe('event')
    expect(typeof seen[0]?.ts).toBe('number')
  })

  it('clientCount() reports zero with no connections', async () => {
    const { bus } = await startHarness()
    expect(bus.clientCount()).toBe(0)
  })
})

describe('createServerBus — WebSocket transport', () => {
  it('a connecting client receives subsequent emits as JSON envelopes', async () => {
    const { bus, port } = await startHarness()
    const ws = await connectClient(port)
    const received: unknown[] = []
    ws.on('message', (msg) => received.push(JSON.parse(String(msg))))

    // Tiny race window between handshake completion and the server
    // tracking the client; emits before that race resolves are lost.
    await waitFor(() => bus.clientCount() === 1)
    bus.emit('hello', { v: 1 })

    await waitFor(() => received.length === 1)
    const env = received[0] as Record<string, unknown>
    expect(env.type).toBe('hello')
    expect(env.payload).toEqual({ v: 1 })
    expect(env.__kick_origin).toBe('local')
    ws.close()
  })

  it('client-emitted messages dispatch to local subscribers', async () => {
    const { bus, port } = await startHarness()
    const ws = await connectClient(port)
    const handler = vi.fn()
    bus.on('from-client', handler)
    await waitFor(() => bus.clientCount() === 1)

    ws.send(JSON.stringify({ type: 'from-client', payload: 'data', ts: 99 }))
    await waitFor(() => handler.mock.calls.length === 1)
    expect(handler).toHaveBeenCalledWith('data')
    ws.close()
  })

  it('client-emitted messages do NOT echo to other clients (loop avoidance)', async () => {
    const { port, bus } = await startHarness()
    const a = await connectClient(port)
    const b = await connectClient(port)
    await waitFor(() => bus.clientCount() === 2)

    const aReceived: unknown[] = []
    const bReceived: unknown[] = []
    a.on('message', (msg) => aReceived.push(JSON.parse(String(msg))))
    b.on('message', (msg) => bReceived.push(JSON.parse(String(msg))))

    a.send(JSON.stringify({ type: 'from-a', payload: 1, ts: 1 }))
    await wait(50)
    expect(aReceived).toEqual([])
    expect(bReceived).toEqual([])

    a.close()
    b.close()
  })

  it('server emits fan out to every connected client', async () => {
    const { bus, port } = await startHarness()
    const a = await connectClient(port)
    const b = await connectClient(port)
    await waitFor(() => bus.clientCount() === 2)

    const aMsgs: unknown[] = []
    const bMsgs: unknown[] = []
    a.on('message', (msg) => aMsgs.push(JSON.parse(String(msg))))
    b.on('message', (msg) => bMsgs.push(JSON.parse(String(msg))))

    bus.emit('broadcast', { v: 1 })
    await waitFor(() => aMsgs.length === 1 && bMsgs.length === 1)

    expect((aMsgs[0] as Record<string, unknown>).type).toBe('broadcast')
    expect((bMsgs[0] as Record<string, unknown>).type).toBe('broadcast')

    a.close()
    b.close()
  })

  it('drops malformed client messages without crashing', async () => {
    const { bus, port } = await startHarness()
    const ws = await connectClient(port)
    await waitFor(() => bus.clientCount() === 1)

    const handler = vi.fn()
    bus.on('ok', handler)
    ws.send('not json')
    ws.send(JSON.stringify({ no_type: true }))
    ws.send(JSON.stringify({ type: 'ok', payload: 'yes', ts: 1 }))
    await waitFor(() => handler.mock.calls.length === 1)
    expect(handler).toHaveBeenCalledWith('yes')
    ws.close()
  })

  it('removes a client from clientCount() after disconnect', async () => {
    const { bus, port } = await startHarness()
    const ws = await connectClient(port)
    await waitFor(() => bus.clientCount() === 1)
    ws.close()
    await waitFor(() => bus.clientCount() === 0)
  })
})

describe('createServerBus — auth gate', () => {
  it('rejects unauthenticated upgrades with 401 when secret is set', async () => {
    const { port } = await startHarness({ secret: 'top-secret' })
    const ws = new WebSocket(`ws://127.0.0.1:${port}/_debug/_bus`)
    const error = await new Promise<Error>((resolve) => {
      ws.once('error', (err) => resolve(err))
    })
    expect(error.message).toMatch(/401/)
  })

  it('accepts the right token via query parameter', async () => {
    const { bus, port } = await startHarness({ secret: 'top-secret' })
    const ws = await connectClient(port, { token: 'top-secret' })
    await waitFor(() => bus.clientCount() === 1)
    ws.close()
  })

  it('rejects the wrong token with 401', async () => {
    const { port } = await startHarness({ secret: 'top-secret' })
    const ws = new WebSocket(`ws://127.0.0.1:${port}/_debug/_bus?token=wrong`)
    const error = await new Promise<Error>((resolve) => {
      ws.once('error', (err) => resolve(err))
    })
    expect(error.message).toMatch(/401/)
  })

  it('skips auth when secret is false (default)', async () => {
    const { bus, port } = await startHarness({ secret: false })
    const ws = await connectClient(port)
    await waitFor(() => bus.clientCount() === 1)
    ws.close()
  })
})

describe('createServerBus — close()', () => {
  it('drops connected clients when close() is called', async () => {
    const { bus, port } = await startHarness()
    const ws = await connectClient(port)
    await waitFor(() => bus.clientCount() === 1)

    const closed = new Promise<void>((resolve) => ws.once('close', () => resolve()))
    bus.close()
    await closed
    expect(bus.clientCount()).toBe(0)
  })

  it('attachUpgrade is idempotent', async () => {
    const { bus, server } = await startHarness()
    // Second call should be a no-op — no double-handler leak. We
    // verify by counting registered upgrade listeners on the server.
    const before = server.listenerCount('upgrade')
    bus.attachUpgrade(server)
    const after = server.listenerCount('upgrade')
    expect(after).toBe(before)
  })
})

// Helper — poll a predicate up to ~500ms before giving up.
async function waitFor(predicate: () => boolean, timeoutMs = 500): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor timed out after ${timeoutMs}ms`)
    }
    await wait(10)
  }
}
