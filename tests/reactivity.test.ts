import { describe, it, expect, vi } from 'vitest'
import { ref, computed, watch, reactive, isRef, unref, toRefs } from '@forinda/kickjs-core'

describe('ref', () => {
  it('should hold and return a value', () => {
    const count = ref(0)
    expect(count.value).toBe(0)
  })

  it('should update value', () => {
    const count = ref(0)
    count.value = 5
    expect(count.value).toBe(5)
  })

  it('should not trigger on same value', () => {
    const count = ref(0)
    const fn = vi.fn()
    count.subscribe(fn)
    count.value = 0
    expect(fn).not.toHaveBeenCalled()
  })

  it('should notify subscribers on change', () => {
    const count = ref(0)
    const fn = vi.fn()
    count.subscribe(fn)
    count.value = 1
    expect(fn).toHaveBeenCalledWith(1, 0)
  })

  it('should unsubscribe', () => {
    const count = ref(0)
    const fn = vi.fn()
    const unsub = count.subscribe(fn)
    unsub()
    count.value = 1
    expect(fn).not.toHaveBeenCalled()
  })
})

describe('computed', () => {
  it('should derive value from ref', () => {
    const count = ref(2)
    const doubled = computed(() => count.value * 2)
    expect(doubled.value).toBe(4)
  })

  it('should update when dependency changes', () => {
    const count = ref(1)
    const doubled = computed(() => count.value * 2)
    expect(doubled.value).toBe(2)
    count.value = 5
    expect(doubled.value).toBe(10)
  })

  it('should cache value until dependency changes', () => {
    let calls = 0
    const count = ref(1)
    const doubled = computed(() => {
      calls++
      return count.value * 2
    })
    doubled.value
    doubled.value
    doubled.value
    expect(calls).toBe(1)
  })

  it('should chain computed values', () => {
    const count = ref(2)
    const doubled = computed(() => count.value * 2)
    const quadrupled = computed(() => doubled.value * 2)
    expect(quadrupled.value).toBe(8)
    count.value = 3
    expect(quadrupled.value).toBe(12)
  })
})

describe('watch', () => {
  it('should call callback on ref change', () => {
    const count = ref(0)
    const fn = vi.fn()
    watch(count, fn)
    count.value = 1
    expect(fn).toHaveBeenCalledWith(1, 0)
  })

  it('should call callback on computed change', () => {
    const count = ref(0)
    const doubled = computed(() => count.value * 2)
    const fn = vi.fn()
    watch(doubled, fn)
    count.value = 5
    expect(fn).toHaveBeenCalledWith(10, 0)
  })

  it('should support getter function source', () => {
    const count = ref(0)
    const fn = vi.fn()
    watch(() => count.value + 1, fn)
    count.value = 5
    expect(fn).toHaveBeenCalledWith(6, 1)
  })

  it('should support immediate option', () => {
    const count = ref(42)
    const fn = vi.fn()
    watch(count, fn, { immediate: true })
    expect(fn).toHaveBeenCalledWith(42, undefined)
  })

  it('should stop watching when stop is called', () => {
    const count = ref(0)
    const fn = vi.fn()
    const stop = watch(count, fn)
    stop()
    count.value = 1
    expect(fn).not.toHaveBeenCalled()
  })
})

describe('reactive', () => {
  it('should create reactive proxy', () => {
    const state = reactive({ count: 0 })
    expect(state.count).toBe(0)
    state.count = 5
    expect(state.count).toBe(5)
  })

  it('should trigger watchers on property change', () => {
    const state = reactive({ count: 0 })
    const fn = vi.fn()
    watch(() => state.count, fn)
    state.count = 1
    expect(fn).toHaveBeenCalledWith(1, 0)
  })

  it('should work with computed', () => {
    const state = reactive({ users: 100, errors: 5 })
    const errorRate = computed(() => state.errors / state.users)
    expect(errorRate.value).toBeCloseTo(0.05)
    state.errors = 10
    expect(errorRate.value).toBeCloseTo(0.1)
  })

  it('should handle deep nested objects', () => {
    const state = reactive({ nested: { value: 1 } })
    const fn = vi.fn()
    watch(() => state.nested.value, fn)
    state.nested.value = 2
    expect(fn).toHaveBeenCalledWith(2, 1)
  })
})

describe('isRef', () => {
  it('should return true for refs', () => {
    expect(isRef(ref(0))).toBe(true)
  })

  it('should return false for non-refs', () => {
    expect(isRef(0)).toBe(false)
    expect(isRef({ value: 0 })).toBe(false)
    expect(isRef(null)).toBe(false)
  })
})

describe('unref', () => {
  it('should unwrap ref', () => {
    const count = ref(42)
    expect(unref(count)).toBe(42)
  })

  it('should return plain value as-is', () => {
    expect(unref(42)).toBe(42)
  })
})

describe('toRefs', () => {
  it('should convert object properties to refs', () => {
    const obj = { a: 1, b: 'hello' }
    const refs = toRefs(obj)
    expect(isRef(refs.a)).toBe(true)
    expect(isRef(refs.b)).toBe(true)
    expect(refs.a.value).toBe(1)
    expect(refs.b.value).toBe('hello')
  })
})

describe('real-world: metrics tracking', () => {
  it('should compute error rate reactively', () => {
    const requestCount = ref(0)
    const errorCount = ref(0)
    const errorRate = computed(() =>
      requestCount.value > 0 ? errorCount.value / requestCount.value : 0,
    )
    const warnings: number[] = []

    watch(errorRate, (rate) => {
      if (rate > 0.1) warnings.push(rate)
    })

    // Simulate requests
    for (let i = 0; i < 10; i++) {
      requestCount.value++
    }
    expect(errorRate.value).toBe(0)
    expect(warnings).toHaveLength(0)

    // Simulate errors
    errorCount.value = 2
    expect(errorRate.value).toBe(0.2)
    expect(warnings.length).toBeGreaterThan(0)
  })
})
