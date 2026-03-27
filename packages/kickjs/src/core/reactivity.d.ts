/**
 * Lightweight reactivity system inspired by Vue 3's composition API.
 * Provides ref(), computed(), watch(), and reactive() for observable
 * backend state — config, metrics, health, circuit breakers.
 */
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
export declare function ref<T>(initialValue: T): Ref<T>
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
export declare function computed<T>(getter: () => T): ComputedRef<T>
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
export declare function watch<T>(
  source: WatchSource<T>,
  callback: (newValue: T, oldValue: T) => void,
  options?: WatchOptions,
): () => void
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
export declare function reactive<T extends Record<string, any>>(target: T): T
/** Check if a value is a Ref */
export declare function isRef(value: any): value is Ref
/** Unwrap a ref or return the value as-is */
export declare function unref<T>(value: Ref<T> | T): T
/** Convert all properties of an object to refs */
export declare function toRefs<T extends Record<string, any>>(
  obj: T,
): {
  [K in keyof T]: Ref<T[K]>
}
export {}
//# sourceMappingURL=reactivity.d.ts.map
