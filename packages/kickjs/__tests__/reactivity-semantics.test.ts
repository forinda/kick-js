/**
 * Reactivity: error isolation, isRef/unref on computed refs, live toRef(s),
 * complete reactive() tracking, batch(), deep refs and loop detection.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { releaseObservers, setObservers } from '../src/core/observers'
import {
  batch,
  computed,
  isRef,
  reactive,
  ref,
  toRef,
  toRefs,
  unref,
  watch,
} from '../src/core/reactivity'

/** Collect what reaches `onError` observers while a test runs. */
function captureErrors() {
  const errors: unknown[] = []
  const installed = setObservers([{ name: 'test', onError: (err) => void errors.push(err) }])
  return { errors, release: () => releaseObservers(installed) }
}

let release: (() => void) | undefined
afterEach(() => {
  release?.()
  release = undefined
})

describe('watchers that throw', () => {
  it('never break the write or the other watchers, and reach onError', () => {
    const capture = captureErrors()
    release = capture.release
    const status = ref('ready')
    const seen: string[] = []
    watch(status, () => {
      throw new Error('boom')
    })
    watch(status, (v) => seen.push(v))
    status.subscribe(() => {
      throw new Error('subscriber boom')
    })

    expect(() => (status.value = 'draining')).not.toThrow()
    expect(status.value).toBe('draining')
    expect(seen).toEqual(['draining'])
    expect(capture.errors.map((e) => (e as Error).message)).toEqual(['boom', 'subscriber boom'])
  })
})

describe('isRef / unref / toRef / toRefs', () => {
  it('know computed refs', () => {
    const doubled = computed(() => 2)
    expect(isRef(doubled)).toBe(true)
    expect(unref(doubled)).toBe(2)
    expect(isRef({ value: 1, subscribe: () => {} })).toBe(false)
  })

  it('toRefs gives live views onto the object, both ways', () => {
    const state = reactive({ x: 1, y: 2 })
    const { x } = toRefs(state)
    state.x = 5
    expect(x.value).toBe(5)
    x.value = 7
    expect(state.x).toBe(7)
    const seen: number[] = []
    watch(toRef(state, 'y'), (v) => seen.push(v))
    state.y = 3
    expect(seen).toEqual([3])
  })
})

describe('reactive()', () => {
  it('tracks nested arrays, delete, and key iteration', () => {
    const state = reactive({ list: [1] as number[], bag: { a: 1 } as Record<string, number> })
    const lengths: number[] = []
    watch(
      () => state.list.length,
      (n) => lengths.push(n),
    )
    state.list.push(2)
    state.list.push(3, 4)
    expect(lengths).toEqual([2, 4])

    const keys = computed(() => Object.keys(state.bag).join(','))
    expect(keys.value).toBe('a')
    state.bag.b = 2
    expect(keys.value).toBe('a,b')
    delete state.bag.a
    expect(keys.value).toBe('b')
    const has = computed(() => 'c' in state.bag)
    expect(has.value).toBe(false)
    state.bag.c = 1
    expect(has.value).toBe(true)
  })

  it("doesn't wrap a proxy again", () => {
    const state = reactive({ n: 1 })
    expect(reactive(state)).toBe(state)
  })
})

describe('batch()', () => {
  it('runs watchers once, with the final state', () => {
    const a = ref(1)
    const b = ref(1)
    const sum = computed(() => a.value + b.value)
    const seen: number[] = []
    watch(sum, (v) => seen.push(v))
    const changes: Array<[number, number]> = []
    a.subscribe((v, old) => changes.push([v, old]))

    const result = batch(() => {
      a.value = 2
      a.value = 3
      b.value = 2
      // Computed values are current inside the batch.
      expect(sum.value).toBe(5)
      return 'done'
    })
    expect(result).toBe('done')
    expect(seen).toEqual([5])
    expect(changes).toEqual([[3, 1]])
  })

  it('nests: the outermost batch flushes', () => {
    const n = ref(0)
    const seen: number[] = []
    watch(n, (v) => seen.push(v))
    batch(() => {
      batch(() => {
        n.value = 1
      })
      expect(seen).toEqual([])
      n.value = 2
    })
    expect(seen).toEqual([2])
  })
})

describe('ref(value, { deep: true })', () => {
  it('notifies on nested changes; a plain ref does not', () => {
    const deep = ref({ retries: 3, tags: ['a'] }, { deep: true })
    const shallow = ref({ retries: 3 })
    const seen: string[] = []
    watch(
      () => deep.value.retries,
      () => seen.push('retries'),
    )
    watch(
      () => deep.value.tags.length,
      () => seen.push('tags'),
    )
    watch(
      () => shallow.value.retries,
      () => seen.push('shallow'),
    )

    deep.value.retries = 5
    deep.value.tags.push('b')
    shallow.value.retries = 5
    expect(seen).toEqual(['retries', 'tags'])
    expect(JSON.stringify(deep)).toBe('{"retries":5,"tags":["a","b"]}')
  })
})

describe('loop detection', () => {
  it('stops a watcher that keeps writing to what it watches, and reports it', () => {
    const capture = captureErrors()
    release = capture.release
    const n = ref(0)
    watch(n, (v) => {
      n.value = v + 1
    })
    n.value = 1
    expect(n.value).toBeGreaterThan(1)
    expect(capture.errors).toHaveLength(1)
    expect((capture.errors[0] as Error).message).toMatch(/Reactivity loop/)

    // Separate updates count afresh: many writes in a row are not a loop.
    const m = ref(0)
    const seen: number[] = []
    watch(m, (v) => seen.push(v))
    for (let i = 1; i <= 150; i++) m.value = i
    expect(seen).toHaveLength(150)
  })
})
