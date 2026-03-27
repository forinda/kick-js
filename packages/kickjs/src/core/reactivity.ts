/**
 * Lightweight reactivity system inspired by Vue 3's composition API.
 * Provides ref(), computed(), watch(), and reactive() for observable
 * backend state — config, metrics, health, circuit breakers.
 */

// ── Dependency Tracking ─────────────────────────────────────────────────

type Effect = () => void
let activeEffect: Effect | null = null
const targetMap = new WeakMap<object, Map<string | symbol, Set<Effect>>>()

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
}

function trigger(target: object, key: string | symbol): void {
  const depsMap = targetMap.get(target)
  if (!depsMap) return
  const deps = depsMap.get(key)
  if (!deps) return
  for (const effect of deps) {
    effect()
  }
}

// ── ref() ────────────────────────────────────────────────────────────────

export interface Ref<T = any> {
  value: T
  /** Subscribe to changes. Returns unsubscribe function. */
  subscribe(fn: (newValue: T, oldValue: T) => void): () => void
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
  }
}

// ── computed() ───────────────────────────────────────────────────────────

export interface ComputedRef<T = any> {
  readonly value: T
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
  const wrapper = { _value: undefined as T }

  const effect: Effect = () => {
    dirty = true
    trigger(wrapper, '_value')
  }

  return {
    get value(): T {
      track(wrapper, '_value')
      if (dirty) {
        const prev = activeEffect
        activeEffect = effect
        try {
          cached = getter()
        } finally {
          activeEffect = prev
        }
        wrapper._value = cached
        dirty = false
      }
      return cached
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

  const job: Effect = () => {
    if (stopped) return
    const newValue = getter()
    if (!Object.is(newValue, oldValue)) {
      callback(newValue, oldValue)
      oldValue = newValue
    }
  }

  // Initial run to establish tracking
  const prev = activeEffect
  activeEffect = job
  try {
    oldValue = getter()
  } finally {
    activeEffect = prev
  }

  if (options?.immediate) {
    callback(oldValue, undefined as T)
  }

  return () => {
    stopped = true
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
export function reactive<T extends Record<string, any>>(target: T): T {
  return new Proxy(target, {
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
