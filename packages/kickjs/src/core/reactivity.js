/**
 * Lightweight reactivity system inspired by Vue 3's composition API.
 * Provides ref(), computed(), watch(), and reactive() for observable
 * backend state — config, metrics, health, circuit breakers.
 */
let activeEffect = null;
const targetMap = new WeakMap();
function track(target, key) {
    if (!activeEffect)
        return;
    let depsMap = targetMap.get(target);
    if (!depsMap) {
        depsMap = new Map();
        targetMap.set(target, depsMap);
    }
    let deps = depsMap.get(key);
    if (!deps) {
        deps = new Set();
        depsMap.set(key, deps);
    }
    deps.add(activeEffect);
}
function trigger(target, key) {
    const depsMap = targetMap.get(target);
    if (!depsMap)
        return;
    const deps = depsMap.get(key);
    if (!deps)
        return;
    for (const effect of deps) {
        effect();
    }
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
export function ref(initialValue) {
    const subscribers = new Set();
    const wrapper = { _value: initialValue };
    return {
        get value() {
            track(wrapper, '_value');
            return wrapper._value;
        },
        set value(newValue) {
            const oldValue = wrapper._value;
            if (Object.is(oldValue, newValue))
                return;
            wrapper._value = newValue;
            trigger(wrapper, '_value');
            for (const fn of subscribers) {
                fn(newValue, oldValue);
            }
        },
        subscribe(fn) {
            subscribers.add(fn);
            return () => subscribers.delete(fn);
        },
    };
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
export function computed(getter) {
    let cached;
    let dirty = true;
    const wrapper = { _value: undefined };
    const effect = () => {
        dirty = true;
        trigger(wrapper, '_value');
    };
    return {
        get value() {
            track(wrapper, '_value');
            if (dirty) {
                const prev = activeEffect;
                activeEffect = effect;
                try {
                    cached = getter();
                }
                finally {
                    activeEffect = prev;
                }
                wrapper._value = cached;
                dirty = false;
            }
            return cached;
        },
    };
}
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
export function watch(source, callback, options) {
    let oldValue;
    let stopped = false;
    const getter = typeof source === 'function' ? source : () => source.value;
    const job = () => {
        if (stopped)
            return;
        const newValue = getter();
        if (!Object.is(newValue, oldValue)) {
            callback(newValue, oldValue);
            oldValue = newValue;
        }
    };
    // Initial run to establish tracking
    const prev = activeEffect;
    activeEffect = job;
    try {
        oldValue = getter();
    }
    finally {
        activeEffect = prev;
    }
    if (options?.immediate) {
        callback(oldValue, undefined);
    }
    return () => {
        stopped = true;
    };
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
export function reactive(target) {
    return new Proxy(target, {
        get(obj, key, receiver) {
            const value = Reflect.get(obj, key, receiver);
            if (typeof key === 'symbol')
                return value;
            track(obj, key);
            // Deep reactivity for nested objects
            if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
                return reactive(value);
            }
            return value;
        },
        set(obj, key, value, receiver) {
            const oldValue = Reflect.get(obj, key, receiver);
            const result = Reflect.set(obj, key, value, receiver);
            if (!Object.is(oldValue, value) && typeof key !== 'symbol') {
                trigger(obj, key);
            }
            return result;
        },
    });
}
// ── Utility ──────────────────────────────────────────────────────────────
/** Check if a value is a Ref */
export function isRef(value) {
    return value !== null && typeof value === 'object' && 'subscribe' in value && 'value' in value;
}
/** Unwrap a ref or return the value as-is */
export function unref(value) {
    return isRef(value) ? value.value : value;
}
/** Convert all properties of an object to refs */
export function toRefs(obj) {
    const result = {};
    for (const key in obj) {
        result[key] = ref(obj[key]);
    }
    return result;
}
//# sourceMappingURL=reactivity.js.map