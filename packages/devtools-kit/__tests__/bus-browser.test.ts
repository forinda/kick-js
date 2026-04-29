// Coverage for the browser bus — BroadcastChannel + WebSocket
// transports plus the loop-avoidance contract (received events
// dispatch locally but DON'T re-broadcast, otherwise two open tabs
// would echo every event back at each other forever).
//
// Vitest runs in Node, so neither BroadcastChannel nor WebSocket
// exist by default. We install minimal stubs on the global before
// each test and tear them down after — a single deterministic
// in-memory transport per test, then assert who fired what.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createBrowserBus } from '../src/bus/browser'

interface FakeChannelInstance {
  name: string
  postMessage: ReturnType<typeof vi.fn>
  listeners: Array<(msg: { data: unknown }) => void>
  emit(data: unknown): void
}

interface FakeWebSocketInstance {
  url: string
  readyState: number
  send: ReturnType<typeof vi.fn>
  listeners: Map<string, Array<(msg: unknown) => void>>
  fireOpen(): void
  fireMessage(data: string): void
  fireClose(): void
}

// Captured between createBrowserBus call and assertion — the test
// reaches in via these refs to drive transport behavior.
let lastChannel: FakeChannelInstance | null = null
let lastSocket: FakeWebSocketInstance | null = null

beforeEach(() => {
  lastChannel = null
  lastSocket = null

  // BroadcastChannel stub
  class FakeChannel {
    name: string
    postMessage = vi.fn()
    listeners: Array<(msg: { data: unknown }) => void> = []
    constructor(name: string) {
      this.name = name
      lastChannel = this as unknown as FakeChannelInstance
    }
    addEventListener(type: string, fn: (msg: { data: unknown }) => void): void {
      if (type === 'message') this.listeners.push(fn)
    }
    emit(data: unknown): void {
      for (const fn of this.listeners) fn({ data })
    }
  }
  ;(globalThis as unknown as { BroadcastChannel: typeof FakeChannel }).BroadcastChannel =
    FakeChannel

  // WebSocket stub — readyState constants match the browser spec.
  class FakeWebSocket {
    static readonly CONNECTING = 0
    static readonly OPEN = 1
    static readonly CLOSING = 2
    static readonly CLOSED = 3
    url: string
    readyState = FakeWebSocket.CONNECTING
    send = vi.fn()
    listeners = new Map<string, Array<(msg: unknown) => void>>()
    constructor(url: string) {
      this.url = url
      lastSocket = this as unknown as FakeWebSocketInstance
    }
    addEventListener(type: string, fn: (msg: unknown) => void): void {
      const arr = this.listeners.get(type) ?? []
      arr.push(fn)
      this.listeners.set(type, arr)
    }
    fireOpen(): void {
      this.readyState = FakeWebSocket.OPEN
      this.listeners.get('open')?.forEach((fn) => fn({}))
    }
    fireMessage(data: string): void {
      this.listeners.get('message')?.forEach((fn) => fn({ data }))
    }
    fireClose(): void {
      this.readyState = FakeWebSocket.CLOSED
      this.listeners.get('close')?.forEach((fn) => fn({}))
    }
  }
  ;(globalThis as unknown as { WebSocket: typeof FakeWebSocket }).WebSocket = FakeWebSocket
})

afterEach(() => {
  // Leave the globals in place between tests is fine, but clear refs
  // so nothing leaks across the suite boundary.
  delete (globalThis as Record<string, unknown>).BroadcastChannel
  delete (globalThis as Record<string, unknown>).WebSocket
  lastChannel = null
  lastSocket = null
})

describe('createBrowserBus — local subscribe + emit', () => {
  it('delivers locally-emitted events to local on() subscribers', () => {
    const bus = createBrowserBus({ channel: false })
    const handler = vi.fn()
    bus.on('x', handler)
    bus.emit('x', { v: 1 })
    expect(handler).toHaveBeenCalledWith({ v: 1 })
  })

  it('onAny sees the full envelope on local emit, including ts', () => {
    const bus = createBrowserBus({ channel: false })
    const seen: Array<{ type: string; ts: number }> = []
    bus.onAny((e) => seen.push({ type: e.type, ts: e.ts }))
    bus.emit('local', null)
    expect(seen[0]?.type).toBe('local')
    expect(typeof seen[0]?.ts).toBe('number')
  })
})

describe('createBrowserBus — BroadcastChannel transport', () => {
  it('forwards local emits via channel.postMessage', () => {
    const bus = createBrowserBus()
    bus.emit('shared', { v: 9 })
    expect(lastChannel?.postMessage).toHaveBeenCalled()
    const arg = lastChannel?.postMessage.mock.calls[0]?.[0] as Record<string, unknown>
    expect(arg.type).toBe('shared')
    expect(arg.payload).toEqual({ v: 9 })
    expect(arg.__kick_origin).toBe('local')
  })

  it('dispatches received broadcast events to local subscribers', () => {
    const bus = createBrowserBus()
    const handler = vi.fn()
    bus.on('remote', handler)
    lastChannel?.emit({ type: 'remote', payload: 'hi', ts: 12345 })
    expect(handler).toHaveBeenCalledWith('hi')
  })

  it('does NOT re-broadcast received events (loop avoidance)', () => {
    const bus = createBrowserBus()
    bus.on('echo', vi.fn())
    const sentBefore = lastChannel?.postMessage.mock.calls.length ?? 0
    lastChannel?.emit({ type: 'echo', payload: 1, ts: 10 })
    const sentAfter = lastChannel?.postMessage.mock.calls.length ?? 0
    expect(sentAfter).toBe(sentBefore)
  })

  it('preserves caller ts on received broadcast events (no re-stamp)', () => {
    const bus = createBrowserBus()
    const seen: number[] = []
    bus.onAny((e) => seen.push(e.ts))
    lastChannel?.emit({ type: 'r', payload: null, ts: 99999 })
    expect(seen[0]).toBe(99999)
  })

  it('disabled BroadcastChannel skips channel construction', () => {
    createBrowserBus({ channel: false })
    expect(lastChannel).toBeNull()
  })

  it('drops malformed broadcast messages silently', () => {
    const bus = createBrowserBus()
    const handler = vi.fn()
    bus.on('x', handler)
    lastChannel?.emit({ no_type: true })
    lastChannel?.emit(null)
    lastChannel?.emit({ type: 'x' /* missing ts */ })
    expect(handler).not.toHaveBeenCalled()
  })
})

describe('createBrowserBus — WebSocket transport', () => {
  it('opens the socket lazily on first subscribe', () => {
    expect(lastSocket).toBeNull()
    const bus = createBrowserBus({ wsUrl: 'ws://localhost:1/_devtools' })
    expect(lastSocket).toBeNull() // no subscribe yet
    bus.on('x', vi.fn())
    expect(lastSocket?.url).toBe('ws://localhost:1/_devtools')
  })

  it('opens the socket lazily on first emit when no prior subscribe', () => {
    const bus = createBrowserBus({ wsUrl: 'ws://localhost:1/_devtools', channel: false })
    expect(lastSocket).toBeNull()
    bus.emit('x', 1)
    // emit triggers connect() via the broadcast() lazy-open path.
    expect(lastSocket?.url).toBe('ws://localhost:1/_devtools')
  })

  it('forwards local emits over the open socket', () => {
    const bus = createBrowserBus({ wsUrl: 'ws://x', channel: false })
    bus.on('hello', vi.fn())
    lastSocket?.fireOpen()
    bus.emit('hello', 1)
    expect(lastSocket?.send).toHaveBeenCalled()
    const sent = lastSocket?.send.mock.calls[0]?.[0] as string
    const parsed = JSON.parse(sent) as { type: string; payload: number }
    expect(parsed.type).toBe('hello')
    expect(parsed.payload).toBe(1)
  })

  it('dispatches received WS events to local subscribers', () => {
    const bus = createBrowserBus({ wsUrl: 'ws://x', channel: false })
    const handler = vi.fn()
    bus.on('server-event', handler)
    lastSocket?.fireOpen()
    lastSocket?.fireMessage(JSON.stringify({ type: 'server-event', payload: 'data', ts: 5 }))
    expect(handler).toHaveBeenCalledWith('data')
  })

  it('preserves caller ts + pluginId on received WS events', () => {
    const bus = createBrowserBus({ wsUrl: 'ws://x', channel: false })
    const seen: Array<{ ts: number; pluginId?: string }> = []
    bus.onAny((e) => seen.push({ ts: e.ts, pluginId: e.pluginId }))
    lastSocket?.fireOpen()
    lastSocket?.fireMessage(
      JSON.stringify({ type: 'r', payload: null, ts: 7777, pluginId: 'kick/db' }),
    )
    expect(seen[0]).toEqual({ ts: 7777, pluginId: 'kick/db' })
  })

  it('drops malformed WS frames without crashing', () => {
    const bus = createBrowserBus({ wsUrl: 'ws://x', channel: false })
    const handler = vi.fn()
    bus.on('ok', handler)
    lastSocket?.fireOpen()
    lastSocket?.fireMessage('not json')
    lastSocket?.fireMessage(JSON.stringify({ no_type: true }))
    lastSocket?.fireMessage(JSON.stringify({ type: 'ok', payload: 'yes', ts: 1 }))
    expect(handler).toHaveBeenCalledOnce()
    expect(handler).toHaveBeenCalledWith('yes')
  })
})
