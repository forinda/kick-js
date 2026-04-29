// Coverage for the activity-log payload summariser. The component
// itself is Solid + SPA-only and tested manually in the dashboard;
// this pure helper is the part that breaks if a future payload type
// (BigInt-heavy migration metadata, recursive container snapshot,
// etc.) sneaks past the summariser unsafely.

import { describe, expect, it } from 'vitest'

import {
  formatActivityTs,
  summarisePayload,
} from '../spa/src/lib/payload-summary'

describe('summarisePayload', () => {
  it('returns String() for primitives', () => {
    expect(summarisePayload(null)).toBe('null')
    expect(summarisePayload(undefined)).toBe('undefined')
    expect(summarisePayload('hello')).toBe('hello')
    expect(summarisePayload(42)).toBe('42')
    expect(summarisePayload(true)).toBe('true')
  })

  it('JSON-stringifies plain objects', () => {
    expect(summarisePayload({ a: 1, b: 'x' })).toBe('{"a":1,"b":"x"}')
  })

  it('handles cycles without crashing', () => {
    const a: { self?: unknown } = { self: undefined }
    a.self = a
    const out = summarisePayload(a)
    expect(out).toContain('[Circular]')
  })

  it('renders BigInt as a string with `n` suffix', () => {
    expect(summarisePayload({ n: 9007199254740993n })).toBe('{"n":"9007199254740993n"}')
  })

  it('renders Error instances with name + message', () => {
    const e = new TypeError('bad')
    expect(summarisePayload({ err: e })).toBe('{"err":{"name":"TypeError","message":"bad"}}')
  })

  it('truncates long payloads with a remaining-char hint', () => {
    const big = { value: 'x'.repeat(500) }
    const out = summarisePayload(big)
    expect(out).toContain('…')
    expect(out).toMatch(/\(\+\d+ chars\)/)
    expect(out.length).toBeLessThan(250)
  })

  it('falls back to [unserialisable] when JSON.stringify throws synchronously', () => {
    const obj = {
      get boom(): never {
        throw new Error('explode')
      },
    }
    // The getter fires during JSON.stringify and bubbles out — the
    // catch in summarisePayload turns it into the fallback string.
    expect(summarisePayload(obj)).toBe('[unserialisable]')
  })

  it('cycle detection is per-call (does not bleed across separate payloads)', () => {
    const shared = { id: 1 }
    // Two independent payloads referencing `shared`. If the WeakSet
    // were module-scoped the second call would mark shared as
    // [Circular]; per-call scope means both summarise it inline.
    const a = summarisePayload({ x: shared })
    const b = summarisePayload({ y: shared })
    expect(a).toBe('{"x":{"id":1}}')
    expect(b).toBe('{"y":{"id":1}}')
  })
})

describe('formatActivityTs', () => {
  it('formats as HH:MM:SS.mmm with zero-padding', () => {
    // Construct a timestamp that's not at midnight + has tricky
    // padding cases (single-digit hour, single-digit ms).
    const ts = new Date(2026, 0, 1, 9, 5, 7, 42).getTime()
    expect(formatActivityTs(ts)).toBe('09:05:07.042')
  })

  it('handles maxed-out fields', () => {
    const ts = new Date(2026, 0, 1, 23, 59, 59, 999).getTime()
    expect(formatActivityTs(ts)).toBe('23:59:59.999')
  })
})
