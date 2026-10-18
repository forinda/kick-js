/**
 * Lightweight reactivity system inspired by Vue 3's composition API.
 * Provides ref(), computed(), watch(), reactive() and batch() for observable
 * backend state — config, metrics, health, circuit breakers.
 */
import { createLogger } from './logger'
import { reportError } from './observers'

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
  /**
   * A computed's effect: it only marks the computed stale and passes the
   * change on, so it runs at once even inside batch(). Watchers and ref
   * subscribers wait for the batch to end.
   */
  computed?: boolean
}

let activeEffect: Effect | null = null
const targetMap = new WeakMap<object, Map<string | symbol, Set<Effect>>>()

/** Tracks key iteration (`Object.keys`, `for…in`) and key additions/removals on an object. */
const ITERATE_KEY = Symbol('iterate')

function createEffect(fn: () => void, computed = false): Effect {
  const effect = fn as Effect
  effect.deps = new Set()
  if (computed) effect.computed = true
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

/** Run `fn` without tracking — what an array mutator reads isn't a dependency. */
function untracked<T>(fn: () => T): T {
  const prev = activeEffect
  activeEffect = null
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
  const deps = targetMap.get(target)?.get(key)
  if (!deps || deps.size === 0) return
  for (const effect of Array.from(deps)) schedule(effect)
}

// ── Scheduling: batch, error isolation, loop detection ──────────────────

let batchDepth = 0
const queue = new Set<Effect>()

function schedule(effect: Effect): void {
  if (batchDepth > 0 && !effect.computed) queue.add(effect)
  else runEffect(effect)
}

/**
 * How many times one effect may be re-triggered within a single synchronous
 * cascade before it is stopped as a loop — a watcher that writes to what it
 * watches, or two that write to each other.
 */
const MAX_RERUNS = 100
let cascadeDepth = 0
const cascadeRuns = new Map<Effect, number>()

const log = createLogger('Reactivity')

function report(err: unknown): void {
  try {
    log.error({ err }, 'A watcher threw. The change still applied, and the other watchers ran.')
  } catch {
    // A failing logger must not turn a watcher error back into a throw.
  }
  reportError(err, { source: 'watch' })
}

/**
 * Run one effect. Its error is reported, never thrown: the write that
 * triggered it, and every other effect it triggered, carry on regardless.
 */
function runEffect(effect: Effect): void {
  const runs = (cascadeRuns.get(effect) ?? 0) + 1
  if (runs > MAX_RERUNS) {
    if (runs === MAX_RERUNS + 1) {
      cascadeRuns.set(effect, runs)
      report(
        new Error(
          `Reactivity loop: an effect was re-triggered ${MAX_RERUNS} times in one update — ` +
            'a watcher that writes to what it watches, or two that write to each other. Stopped it.',
        ),
      )
    }
    return
  }
  cascadeRuns.set(effect, runs)
  cascadeDepth++
  try {
    effect()
  } catch (err) {
    report(err)
  } finally {
    if (--cascadeDepth === 0) cascadeRuns.clear()
  }
}

/**
 * Apply several writes as one update: watchers and ref subscribers run once,
 * after `fn` returns, with the final values — never with a half-applied state.
 * Computed values stay current inside the batch. Batches nest; the outermost
 * one flushes. Returns what `fn` returns.
 *
 * @example
 * ```ts
 * const total = computed(() => a.value + b.value)
 * watch(total, (v) => console.log(v))
 * batch(() => {
 *   a.value = 2
 *   b.value = 2
 * }) // logs 4 once, not 3 then 4
 * ```
 */
export function batch<T>(fn: () => T): T {
  batchDepth++
  try {
    return fn()
  } finally {
    if (--batchDepth === 0) {
      while (queue.size > 0) {
        const pending = [...queue]
        queue.clear()
        for (const effect of pending) runEffect(effect)
      }
    }
  }
}

// ── ref() ────────────────────────────────────────────────────────────────

/** Marks refs, computed refs and `toRef()` views, for {@link isRef}. */
const REF = Symbol.for('kickjs.ref')

export interface Ref<T = any> {
  value: T
  /**
   * Subscribe to changes. Returns unsubscribe function. Inside {@link batch},
   * called once when the batch ends, if the value differs from before it.
   */
  subscribe(fn: (newValue: T, oldValue: T) => void): () => void
  /**
   * Auto-unwrap on `JSON.stringify` — returns the underlying value
   * so refs serialize transparently inside larger payloads (introspect
   * snapshots, devtools state, request responses). Equivalent to
   * `unref(ref)` but invoked implicitly by the JSON pipeline.
   */
  toJSON(): T
}

export interface RefOptions {
  /**
   * Make an object value deeply reactive: `r.value.count++` and
   * `r.value.items.push(x)` notify too, not only replacing `r.value`.
   * Default: false — only assigning `.value` notifies.
   */
  deep?: boolean
}

/**
 * Create a reactive reference. Reading `.value` tracks the dependency,
 * writing `.value` triggers watchers and computed recalculations.
 *
 * @example
 * ```ts
 * const count = ref(0)
 * count.value++  // triggers watchers
 *
 * const config = ref({ retries: 3 }, { deep: true })
 * config.value.retries = 5 // triggers watchers too
 * ```
 */
export function ref<T>(initialValue: T, options: RefOptions = {}): Ref<T> {
  const subscribers = new Set<(newValue: T, oldValue: T) => void>()
  const wrapper = { _value: initialValue }
  const deep = options.deep === true

  const notify = (newValue: T, oldValue: T) => {
    // A copy: a subscriber may unsubscribe while being notified.
    for (const fn of Array.from(subscribers)) {
      try {
        fn(newValue, oldValue)
      } catch (err) {
        report(err)
      }
    }
  }
  // Inside a batch, subscribers hear once, with the value from before the
  // batch and the one after it.
  let batchedFrom: { value: T } | null = null
  const flush = createEffect(() => {
    const from = batchedFrom!
    batchedFrom = null
    if (!Object.is(from.value, wrapper._value)) notify(wrapper._value, from.value)
  })

  return {
    [REF]: true,
    get value(): T {
      track(wrapper, '_value')
      const value = wrapper._value
      return deep && value !== null && typeof value === 'object'
        ? (reactive(value as object) as T)
        : value
    },
    set value(newValue: T) {
      const oldValue = wrapper._value
      if (Object.is(oldValue, newValue)) return
      wrapper._value = newValue
      trigger(wrapper, '_value')
      if (subscribers.size === 0) return
      if (batchDepth > 0) {
        batchedFrom ??= { value: oldValue }
        queue.add(flush)
      } else {
        notify(newValue, oldValue)
      }
    },
    subscribe(fn: (newValue: T, oldValue: T) => void): () => void {
      subscribers.add(fn)
      return () => subscribers.delete(fn)
    },
    toJSON(): T {
      return wrapper._value
    },
  } as Ref<T>
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
  }, true)

  const recompute = (): T => {
    // Disposed: plain evaluation with tracking SUSPENDED — neither this
    // computed's effect nor any OUTER active effect (a watcher reading
    // `.value`) may attach to the sources through a disposed computed;
    // otherwise disposal wouldn't actually sever the subscription chain.
    if (disposed) return untracked(getter)
    if (dirty) {
      cached = runTracked(effect, getter)
      wrapper._value = cached
      dirty = false
    }
    return cached
  }

  return {
    [REF]: true,
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
  } as ComputedRef<T>
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
 * A callback that throws is reported (logged, and passed to `onError`
 * observers) instead of thrown: the write that triggered it, and every other
 * watcher, carry on. Inside {@link batch}, the callback runs once, after the
 * batch.
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
      const previous = oldValue
      // Advanced before the callback, so one that throws isn't re-called
      // with the same change on the next run.
      oldValue = newValue
      callback(newValue, previous)
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
    queue.delete(job)
    cleanupEffect(job)
  }
}

// ── reactive() ───────────────────────────────────────────────────────────

/**
 * Create a deeply reactive proxy around an object or array. Property reads
 * are tracked, writes and deletes trigger watchers and computed
 * recalculations, and so do key additions and removals for code that
 * iterates the keys (`Object.keys`, `for…in`, `in`). Nested objects and
 * arrays are reactive too.
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
/** Proxies this module made — `reactive(proxy)` returns it rather than wrapping it again. */
const proxies = new WeakSet<object>()

/** Array methods that change the array: run untracked and as one update. */
const ARRAY_MUTATORS = new Set([
  'push',
  'pop',
  'shift',
  'unshift',
  'splice',
  'sort',
  'reverse',
  'fill',
  'copyWithin',
])

export function reactive<T extends object>(target: T): T {
  if (proxies.has(target)) return target
  const existing = proxyCache.get(target)
  if (existing) return existing as T
  const isArray = Array.isArray(target)
  // What iterating this target depends on: an array's length, an object's key set.
  const iterateKey = isArray ? 'length' : ITERATE_KEY
  const proxy: T = new Proxy(target, {
    get(obj, key, receiver) {
      if (isArray && typeof key === 'string' && ARRAY_MUTATORS.has(key)) {
        const method = Reflect.get(obj, key, receiver) as (...args: unknown[]) => unknown
        return (...args: unknown[]) => batch(() => untracked(() => method.apply(proxy, args)))
      }
      const value = Reflect.get(obj, key, receiver)
      if (typeof key === 'symbol') return value
      track(obj, key)
      // Deep reactivity for nested objects and arrays
      if (value !== null && typeof value === 'object') return reactive(value)
      return value
    },
    set(obj, key, value, receiver) {
      const hadKey =
        isArray && typeof key === 'string' && /^\d+$/.test(key)
          ? Number(key) < (obj as unknown[]).length
          : Object.hasOwn(obj, key)
      const oldValue = Reflect.get(obj, key, receiver)
      const result = Reflect.set(obj, key, value, receiver)
      if (typeof key === 'symbol') return result
      if (!hadKey) {
        batch(() => {
          trigger(obj, key)
          // A new array index grows the array, but its `length` write that
          // follows sees the length already updated — so it's triggered here.
          trigger(obj, iterateKey)
        })
      } else if (!Object.is(oldValue, value)) {
        trigger(obj, key)
      }
      return result
    },
    deleteProperty(obj, key) {
      const hadKey = Object.hasOwn(obj, key)
      const result = Reflect.deleteProperty(obj, key)
      if (result && hadKey && typeof key !== 'symbol') {
        batch(() => {
          trigger(obj, key)
          trigger(obj, iterateKey)
        })
      }
      return result
    },
    has(obj, key) {
      if (typeof key !== 'symbol') track(obj, key)
      return Reflect.has(obj, key)
    },
    ownKeys(obj) {
      track(obj, iterateKey)
      return Reflect.ownKeys(obj)
    },
  })
  proxyCache.set(target, proxy)
  proxies.add(proxy)
  return proxy
}

// ── Utility ──────────────────────────────────────────────────────────────

/** Check if a value is a ref — from {@link ref}, {@link computed} or {@link toRef}. */
export function isRef<T = any>(value: unknown): value is Ref<T> | ComputedRef<T> {
  return value !== null && typeof value === 'object' && (value as any)[REF] === true
}

/** Unwrap a ref or computed ref, or return the value as-is */
export function unref<T>(value: Ref<T> | ComputedRef<T> | T): T {
  return isRef(value) ? (value.value as T) : (value as T)
}

/**
 * A ref that reads and writes `obj[key]`: a live view, not a copy. On a
 * {@link reactive} object, watching it follows changes made either way.
 */
export function toRef<T extends object, K extends keyof T>(obj: T, key: K): Ref<T[K]> {
  return {
    [REF]: true,
    get value(): T[K] {
      return obj[key]
    },
    set value(value: T[K]) {
      obj[key] = value
    },
    subscribe(fn: (newValue: T[K], oldValue: T[K]) => void): () => void {
      return watch(() => obj[key], fn)
    },
    toJSON(): T[K] {
      return obj[key]
    },
  } as Ref<T[K]>
}

/** {@link toRef} for every property: live views onto the object, not copies. */
export function toRefs<T extends object>(obj: T): { [K in keyof T]: Ref<T[K]> } {
  const result = {} as { [K in keyof T]: Ref<T[K]> }
  for (const key of Object.keys(obj) as Array<keyof T>) {
    result[key] = toRef(obj, key)
  }
  return result
}
