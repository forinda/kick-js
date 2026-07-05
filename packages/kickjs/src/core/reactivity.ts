/**
 * Lightweight reactivity system inspired by Vue 3's composition API.
 * Provides ref(), computed(), watch(), and reactive() for observable
 * backend state — config, metrics, health, circuit breakers.
 */

// ── Dependency Tracking ─────────────────────────────────────────────────
//
// Effects carry back-references to every dep Set they were added to, so
// stopping a watcher / disposing a computed — or simply re-running an
// effect whose getter reads different keys this time — removes it from the
// old Sets instead of leaving dead subscriptions to accumulate (and be
// invoked!) forever. Same cleanup discipline as Vue 3's ReactiveEffect.

interface Effect {
  (): void
  /** Dep Sets this effect is currently registered in (for cleanup). */
  deps: Set<Set<Effect>>
}

let activeEffect: Effect | null = null
const targetMap = new WeakMap<object, Map<string | symbol, Set<Effect>>>()

function createEffect(fn: () => void): Effect {
  const effect = fn as Effect
  effect.deps = new Set()
  return effect
}

/** Remove the effect from every dep Set it was tracked into. */
function cleanupEffect(effect: Effect): void {
  for (const depSet of effect.deps) depSet.delete(effect)
  effect.deps.clear()
}

/**
 * Run `fn` with `effect` as the active tracking target, first clearing the
 * effect's previous subscriptions so conditional reads don't leave stale deps.
 */
function runTracked<T>(effect: Effect, fn: () => T): T {
  cleanupEffect(effect)
  const prev = activeEffect
  activeEffect = effect
  try {
    return fn()
  } finally {
    activeEffect = prev
  }
}

function track(target: object, key: string | symbol): void {
  if (!activeEffect) return
  let depsMap = targetMap.get(target)
  if (!depsMap) {
    depsMap = new Map()
    targetMap.set(target, depsMap)
  }
  let deps = depsMap.get(key)
  if (!deps) {
    deps = new Set()
    depsMap.set(key, deps)
  }
  deps.add(activeEffect)
  activeEffect.deps.add(deps)
}

function trigger(target: object, key: string | symbol): void {
  const depsMap = targetMap.get(target)
  if (!depsMap) return
  const deps = depsMap.get(key)
  if (!deps || deps.size === 0) return
  // Iterate a snapshot — a triggered effect re-tracks (mutating `deps`)
  // during its run, which would otherwise corrupt this iteration. The
  // array copy is deliberate, not a useless spread.
  // eslint-disable-next-line unicorn/no-useless-spread
  for (const effect of [...deps]) {
    effect()
  }
}

// ── ref() ────────────────────────────────────────────────────────────────

export interface Ref<T = any> {
  value: T
  /** Subscribe to changes. Returns unsubscribe function. */
  subscribe(fn: (newValue: T, oldValue: T) => void): () => void
  /**
   * Auto-unwrap on `JSON.stringify` — returns the underlying value
   * so refs serialize transparently inside larger payloads (introspect
   * snapshots, devtools state, request responses). Equivalent to
   * `unref(ref)` but invoked implicitly by the JSON pipeline.
   */
  toJSON(): T
}

/**
 * Create a reactive reference. Reading `.value` tracks the dependency,
 * writing `.value` triggers watchers and computed recalculations.
 *
 * @example
 * ```ts
 * const count = ref(0)
 * count.value++  // triggers watchers
 * ```
 */
export function ref<T>(initialValue: T): Ref<T> {
  const subscribers = new Set<(newValue: T, oldValue: T) => void>()
  const wrapper = { _value: initialValue }

  return {
    get value(): T {
      track(wrapper, '_value')
      return wrapper._value
    },
    set value(newValue: T) {
      const oldValue = wrapper._value
      if (Object.is(oldValue, newValue)) return
      wrapper._value = newValue
      trigger(wrapper, '_value')
      for (const fn of subscribers) {
        fn(newValue, oldValue)
      }
    },
    subscribe(fn: (newValue: T, oldValue: T) => void): () => void {
      subscribers.add(fn)
      return () => subscribers.delete(fn)
    },
    /**
     * Auto-unwrap on `JSON.stringify`. Without this, serializing a ref
     * leaks the wrapper shape (`{"value": …, "subscribe": …}`) instead
     * of the underlying value — particularly painful for adopters who
     * keep adapter / plugin state in refs and surface it through
     * `introspect()`. Returning `value` here means
     * `JSON.stringify({ count: ref(0) })` produces `{"count":0}` as
     * expected, without callers having to `.value`-unwrap by hand.
     */
    toJSON(): T {
      return wrapper._value
    },
  }
}

// ── computed() ───────────────────────────────────────────────────────────

export interface ComputedRef<T = any> {
  readonly value: T
  /**
   * Auto-unwrap on `JSON.stringify` — see {@link Ref.toJSON} for the
   * motivation. Triggers a recompute when the cached value is stale,
   * same as reading `.value`.
   */
  toJSON(): T
  /**
   * Unsubscribe this computed from its reactive sources. Call when the
   * computed's lifetime is shorter than its sources' (e.g. created
   * per-request/per-tenant against app-lifetime refs) — without it the
   * internal effect stays pinned in the sources' dep Sets forever.
   * After disposal, reading `.value` still works but recomputes on every
   * access and no longer tracks.
   */
  dispose(): void
}

/**
 * Create a computed value that auto-recalculates when its reactive
 * dependencies change. Cached until a dependency triggers.
 *
 * @example
 * ```ts
 * const count = ref(0)
 * const doubled = computed(() => count.value * 2)
 * count.value = 5
 * console.log(doubled.value) // 10
 * ```
 */
export function computed<T>(getter: () => T): ComputedRef<T> {
  let cached: T
  let dirty = true
  let disposed = false
  const wrapper = { _value: undefined as T }

  const effect = createEffect(() => {
    dirty = true
    trigger(wrapper, '_value')
  })

  const recompute = (): T => {
    // Disposed: plain evaluation, no tracking — the computed must not
    // re-subscribe itself to sources it was explicitly detached from.
    if (disposed) return getter()
    if (dirty) {
      cached = runTracked(effect, getter)
      wrapper._value = cached
      dirty = false
    }
    return cached
  }

  return {
    get value(): T {
      track(wrapper, '_value')
      return recompute()
    },
    dispose(): void {
      disposed = true
      cleanupEffect(effect)
    },
    /**
     * Auto-unwrap on `JSON.stringify`, matching {@link ref}'s behavior
     * so adopters can drop a computed straight into a JSON-bound
     * payload (introspect snapshot, devtools state) and get the value
     * rather than the wrapper shape.
     *
     * Computed values cache through the same dirty-flag the getter
     * uses, so calling `toJSON` is at worst one recompute when stale —
     * identical cost to reading `.value`.
     */
    toJSON(): T {
      return recompute()
    },
  }
}

// ── watch() ──────────────────────────────────────────────────────────────

export interface WatchOptions {
  /** Run the callback immediately with the current value (default: false) */
  immediate?: boolean
}

type WatchSource<T> = Ref<T> | ComputedRef<T> | (() => T)

/**
 * Watch a reactive source and run a callback when it changes.
 * Returns a stop function to unsubscribe.
 *
 * @example
 * ```ts
 * const count = ref(0)
 * const stop = watch(count, (newVal, oldVal) => {
 *   console.log(`Changed from ${oldVal} to ${newVal}`)
 * })
 * count.value = 1  // logs: "Changed from 0 to 1"
 * stop()           // no more callbacks
 * ```
 */
export function watch<T>(
  source: WatchSource<T>,
  callback: (newValue: T, oldValue: T) => void,
  options?: WatchOptions,
): () => void {
  let oldValue: T
  let stopped = false

  const getter = typeof source === 'function' ? source : () => source.value

  const job = createEffect(() => {
    if (stopped) return
    // Re-run the getter UNDER tracking so deps are refreshed each run —
    // a conditional getter (`cond ? a.value : b.value`) drops the branch
    // it no longer reads instead of staying subscribed to it forever.
    const newValue = runTracked(job, getter)
    if (!Object.is(newValue, oldValue)) {
      callback(newValue, oldValue)
      oldValue = newValue
    }
  })

  // Initial run to establish tracking
  oldValue = runTracked(job, getter)

  if (options?.immediate) {
    callback(oldValue, undefined as T)
  }

  return () => {
    // Detach from every dep Set — a flag alone would leave the dead effect
    // referenced (and invoked) by its sources for their entire lifetime.
    stopped = true
    cleanupEffect(job)
  }
}

// ── reactive() ───────────────────────────────────────────────────────────

/**
 * Create a deeply reactive proxy around a plain object. Property reads
 * are tracked, property writes trigger watchers and computed recalculations.
 *
 * @example
 * ```ts
 * const state = reactive({ users: 0, errors: 0 })
 * const errorRate = computed(() =>
 *   state.users > 0 ? state.errors / state.users : 0
 * )
 * state.users = 100
 * state.errors = 5
 * console.log(errorRate.value) // 0.05
 * ```
 */
// Memoize proxies per target: repeated reads of the same nested object must
// return the SAME proxy — otherwise every access allocates a fresh Proxy and
// referential identity breaks (`state.nested !== state.nested`).
const proxyCache = new WeakMap<object, any>()

export function reactive<T extends Record<string, any>>(target: T): T {
  const existing = proxyCache.get(target)
  if (existing) return existing as T
  const proxy = new Proxy(target, {
    get(obj, key, receiver) {
      const value = Reflect.get(obj, key, receiver)
      if (typeof key === 'symbol') return value
      track(obj, key)
      // Deep reactivity for nested objects
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        return reactive(value)
      }
      return value
    },
    set(obj, key, value, receiver) {
      const oldValue = Reflect.get(obj, key, receiver)
      const result = Reflect.set(obj, key, value, receiver)
      if (!Object.is(oldValue, value) && typeof key !== 'symbol') {
        trigger(obj, key)
      }
      return result
    },
  })
  proxyCache.set(target, proxy)
  return proxy
}

// ── Utility ──────────────────────────────────────────────────────────────

/** Check if a value is a Ref */
export function isRef(value: any): value is Ref {
  return value !== null && typeof value === 'object' && 'subscribe' in value && 'value' in value
}

/** Unwrap a ref or return the value as-is */
export function unref<T>(value: Ref<T> | T): T {
  return isRef(value) ? value.value : value
}

/** Convert all properties of an object to refs */
export function toRefs<T extends Record<string, any>>(obj: T): { [K in keyof T]: Ref<T[K]> } {
  const result = {} as any
  for (const key in obj) {
    result[key] = ref(obj[key])
  }
  return result
}
