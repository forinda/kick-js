import 'reflect-metadata'
import { describe, it, expect } from 'vitest'

import { ref, computed, reactive } from '../src/core/reactivity'

/**
 * Locks in the `toJSON` auto-unwrap on ref / computed — added so
 * adapter/plugin authors can return refs from `introspect()` and have
 * JSON.stringify unwrap them transparently. Without this, the wrapper
 * shape leaks (`{"value":…,"subscribe":…}` instead of the underlying
 * value), and adopters had to `.value`-unwrap by hand on every site.
 */
describe('ref().toJSON — auto-unwrap on JSON.stringify', () => {
  it('serializes a primitive ref as its value, not the wrapper', () => {
    const count = ref(42)
    expect(JSON.stringify(count)).toBe('42')
  })

  it('serializes an object ref as its value', () => {
    const user = ref({ id: 1, name: 'alice' })
    expect(JSON.parse(JSON.stringify(user))).toEqual({ id: 1, name: 'alice' })
  })

  it('unwraps refs nested inside a plain object', () => {
    // Real-world shape: an introspect() snapshot whose `state` field
    // contains refs from the adapter's internal reactive state.
    const snapshot = {
      protocolVersion: 1 as const,
      name: 'RedisAdapter',
      kind: 'adapter' as const,
      state: {
        connectedAt: ref(1_700_000_000_000),
        activeConnections: ref(3),
      },
      metrics: {
        cacheHits: ref(120),
      },
    }
    const json = JSON.parse(JSON.stringify(snapshot))
    expect(json.state.connectedAt).toBe(1_700_000_000_000)
    expect(json.state.activeConnections).toBe(3)
    expect(json.metrics.cacheHits).toBe(120)
  })

  it('reflects the current value when serialized after a write', () => {
    const flag = ref(false)
    flag.value = true
    expect(JSON.stringify(flag)).toBe('true')
  })

  it('one-shot unwrap — JSON.stringify calls toJSON exactly once per chain (nested refs preserved as wrapper)', () => {
    // Document the one-shot behavior: `JSON.stringify`'s toJSON
    // substitution fires once per value, so `ref(ref(x))` serializes
    // to the inner ref's enumerable shape (`{"value":x}`), NOT to `x`.
    // Adopters shouldn't wrap a ref in another ref deliberately;
    // assert here so a future "recursive unwrap" refactor doesn't
    // land silently.
    const inner = ref(7)
    const outer = ref(inner)
    expect(JSON.parse(JSON.stringify(outer))).toEqual({ value: 7 })
  })
})

describe('computed().toJSON — auto-unwrap with stale-cache recompute', () => {
  it('serializes a computed value as its current cached result', () => {
    const base = ref(10)
    const doubled = computed(() => base.value * 2)
    expect(JSON.stringify(doubled)).toBe('20')
  })

  it('recomputes if the dependency changed since last read', () => {
    const base = ref(5)
    const doubled = computed(() => base.value * 2)
    // Read once to fill the cache.
    void doubled.value
    base.value = 8
    // toJSON triggers a recompute when stale; identical to reading .value.
    expect(JSON.stringify(doubled)).toBe('16')
  })
})

describe('reactive().toJSON — plain serialization through the Proxy', () => {
  it('serializes a reactive object by walking its enumerable keys', () => {
    // No explicit toJSON on the Proxy — JSON.stringify enumerates
    // the underlying target's keys via the get trap, which returns
    // the raw value for primitives. This test pins existing behavior
    // so a future Proxy refactor doesn't accidentally break it.
    const state = reactive({ users: 10, errors: 0 })
    expect(JSON.parse(JSON.stringify(state))).toEqual({ users: 10, errors: 0 })
  })
})
