// Coverage for the in-memory bus core. Browser/server transports
// wrap this exact dispatcher, so getting the basics right here means
// the surface above only needs to test transport-specific behavior.

import { describe, expect, it, vi } from 'vitest'

import { createBusCore, createInMemoryBus } from '../src/bus/in-memory'

describe('createInMemoryBus', () => {
  it('delivers payloads to matching on() handlers', () => {
    const bus = createInMemoryBus()
    const handler = vi.fn()
    bus.on('hello', handler)
    bus.emit('hello', { value: 1 })
    expect(handler).toHaveBeenCalledWith({ value: 1 })
  })

  it('does not deliver to non-matching handlers', () => {
    const bus = createInMemoryBus()
    const handlerA = vi.fn()
    const handlerB = vi.fn()
    bus.on('a', handlerA)
    bus.on('b', handlerB)
    bus.emit('a', 1)
    expect(handlerA).toHaveBeenCalledOnce()
    expect(handlerB).not.toHaveBeenCalled()
  })

  it('unsubscribes on the returned cleanup function', () => {
    const bus = createInMemoryBus()
    const handler = vi.fn()
    const off = bus.on('x', handler)
    bus.emit('x', 1)
    off()
    bus.emit('x', 2)
    expect(handler).toHaveBeenCalledOnce()
    expect(handler).toHaveBeenCalledWith(1)
  })

  it('tolerates double-unsubscribe (idempotent)', () => {
    const bus = createInMemoryBus()
    const handler = vi.fn()
    const off = bus.on('x', handler)
    off()
    off()
    bus.emit('x', 1)
    expect(handler).not.toHaveBeenCalled()
  })

  it('supports multiple handlers for the same type', () => {
    const bus = createInMemoryBus()
    const a = vi.fn()
    const b = vi.fn()
    bus.on('event', a)
    bus.on('event', b)
    bus.emit('event', 'payload')
    expect(a).toHaveBeenCalledWith('payload')
    expect(b).toHaveBeenCalledWith('payload')
  })

  it('onAny() receives every event with the full envelope', () => {
    const bus = createInMemoryBus()
    const seen: Array<{ type: string; payload: unknown; ts: number }> = []
    bus.onAny((e) => seen.push({ type: e.type, payload: e.payload, ts: e.ts }))
    bus.emit('a', 1)
    bus.emit('b', 2)
    expect(seen).toHaveLength(2)
    expect(seen[0]?.type).toBe('a')
    expect(seen[0]?.payload).toBe(1)
    expect(typeof seen[0]?.ts).toBe('number')
    expect(seen[1]?.type).toBe('b')
    expect(seen[1]?.payload).toBe(2)
  })

  it('onAny() unsubscribes cleanly', () => {
    const bus = createInMemoryBus()
    const handler = vi.fn()
    const off = bus.onAny(handler)
    bus.emit('x', 1)
    off()
    bus.emit('x', 2)
    expect(handler).toHaveBeenCalledOnce()
  })

  it('catches handler exceptions so siblings still fire', () => {
    const bus = createInMemoryBus()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const sibling = vi.fn()
    bus.on('boom', () => {
      throw new Error('handler failed')
    })
    bus.on('boom', sibling)
    bus.emit('boom', null)
    expect(sibling).toHaveBeenCalledOnce()
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('safely handles re-entrant subscribe inside a handler', () => {
    const bus = createInMemoryBus()
    const lateHandler = vi.fn()
    bus.on('x', () => bus.on('x', lateHandler))
    bus.emit('x', 1)
    // First emit only fires the original — the late subscriber was
    // registered DURING dispatch and shouldn't see the in-flight event.
    expect(lateHandler).not.toHaveBeenCalled()
    bus.emit('x', 2)
    expect(lateHandler).toHaveBeenCalledWith(2)
  })

  it('safely handles re-entrant unsubscribe inside a handler', () => {
    const bus = createInMemoryBus()
    const order: string[] = []
    let offSecond: (() => void) | null = null
    bus.on('x', () => {
      order.push('first')
      offSecond?.()
    })
    offSecond = bus.on('x', () => order.push('second'))
    bus.emit('x', 1)
    // Second handler ran (snapshot semantics) even though it was
    // unsubscribed mid-dispatch. Subsequent emit skips it.
    expect(order).toEqual(['first', 'second'])
    bus.emit('x', 2)
    expect(order).toEqual(['first', 'second', 'first'])
  })

  it('emit is synchronous — handler completes before emit returns', () => {
    const bus = createInMemoryBus()
    let observed = 0
    bus.on('x', (v) => {
      observed = v as number
    })
    bus.emit('x', 42)
    expect(observed).toBe(42)
  })
})

describe('createBusCore — dispatch with pre-built envelope', () => {
  it('preserves caller-supplied ts and pluginId on dispatch', () => {
    const core = createBusCore()
    const seen: Array<{ ts: number; pluginId?: string }> = []
    core.onAny((e) => seen.push({ ts: e.ts, pluginId: e.pluginId }))
    core.dispatch({ type: 'remote', payload: null, ts: 12345, pluginId: 'kick/db' })
    expect(seen[0]).toEqual({ ts: 12345, pluginId: 'kick/db' })
  })

  it('on() handlers see only the payload, not the envelope', () => {
    const core = createBusCore()
    const handler = vi.fn()
    core.on('x', handler)
    core.dispatch({ type: 'x', payload: { hi: true }, ts: 1 })
    expect(handler).toHaveBeenCalledWith({ hi: true })
    expect(handler).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'x' }))
  })
})
