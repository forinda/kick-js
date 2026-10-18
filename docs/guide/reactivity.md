# Reactivity

KickJS includes a lightweight reactivity system inspired by Vue 3's Composition API. It provides observable state primitives for backend use cases like metrics tracking, config hot-reload, health monitoring, and circuit breakers.

## Why Reactivity on the Backend?

Frontend frameworks use reactivity to update the DOM. On the backend, the same pattern solves different but equally real problems:

- **Metrics** — reactive counters with computed rates that auto-trigger alerts
- **Health checks** — derived `isHealthy` state from multiple adapter statuses
- **Config hot-reload** — mutate config, middleware auto-reconfigures
- **Circuit breakers** — error count crosses threshold, circuit auto-trips
- **Feature flags** — flip a flag, routes/middleware adjust instantly

## API Reference

### `ref(value)`

Creates a reactive reference. Reading `.value` tracks the dependency, writing `.value` triggers watchers.

```ts
import { ref } from '@forinda/kickjs'

const count = ref(0)
console.log(count.value) // 0

count.value = 5 // triggers watchers

// Subscribe directly to changes
const unsub = count.subscribe((newVal, oldVal) => {
  console.log(`Changed: ${oldVal} → ${newVal}`)
})
unsub() // cleanup
```

A ref is shallow: replacing `.value` notifies, changing inside an object it holds doesn't. Pass `{ deep: true }` to have nested changes notify too:

```ts
const config = ref({ retries: 3, hosts: ['a'] }, { deep: true })
config.value.retries = 5 // notifies
config.value.hosts.push('b') // notifies
```

### `computed(getter)`

Creates a lazy, cached derived value that auto-recalculates when dependencies change.

```ts
import { ref, computed } from '@forinda/kickjs'

const price = ref(100)
const tax = ref(0.2)
const total = computed(() => price.value * (1 + tax.value))

console.log(total.value) // 120
price.value = 200
console.log(total.value) // 240 — auto-updated
```

Computed values are **cached** — the getter only re-runs when a dependency changes:

```ts
let calls = 0
const doubled = computed(() => {
  calls++
  return count.value * 2
})
doubled.value // calls = 1
doubled.value // calls = 1 (cached)
count.value = 10
doubled.value // calls = 2 (recalculated)
```

### `watch(source, callback, options?)`

Runs a side effect when a reactive source changes. Returns a stop function.

```ts
import { ref, watch } from '@forinda/kickjs'

const errorCount = ref(0)

const stop = watch(errorCount, (newVal, oldVal) => {
  console.log(`Errors: ${oldVal} → ${newVal}`)
})

errorCount.value = 5 // logs: "Errors: 0 → 5"
stop() // no more callbacks
```

**Sources** can be a `ref`, `computed`, or a getter function:

```ts
// Watch a computed
watch(errorRate, (rate) => {
  if (rate > 0.1) logger.warn('Error rate elevated')
})

// Watch a getter function
watch(
  () => state.users + state.admins,
  (total) => console.log(`Total users: ${total}`),
)
```

**Options:**

| Option      | Type      | Default | Description                                 |
| ----------- | --------- | ------- | ------------------------------------------- |
| `immediate` | `boolean` | `false` | Run callback immediately with current value |

A callback that throws doesn't break anything else. The error is logged and passed to your `onError` [observers](./observability.md), the write that triggered it still applies, and the other watchers still run. That matters for watchers on `app.status`, which changes during shutdown.

A watcher that writes back to what it watches, or two that keep writing to each other, would never settle. After 100 re-runs within one update, KickJS stops the loop and reports it the same way.

### `reactive(object)`

Creates a deeply reactive proxy around an object or array. Property reads are tracked; writes and `delete` trigger watchers. So do nested arrays (`state.list.push(x)`) and key additions and removals, for code that iterates the keys (`Object.keys`, `for…in`, `in`).

```ts
import { reactive, computed, watch } from '@forinda/kickjs'

const metrics = reactive({
  requests: 0,
  errors: 0,
})

const errorRate = computed(() => (metrics.requests > 0 ? metrics.errors / metrics.requests : 0))

watch(errorRate, (rate) => {
  if (rate > 0.5) alertOncall('Service degraded')
})

// In middleware — just mutate, side effects happen automatically
metrics.requests++
```

### `batch(fn)`

Writes take effect at once, so two related writes would show watchers a half-applied state in between. Group them, and watchers and `subscribe` callbacks run once, after `fn`, with the final values:

```ts
import { batch, computed, ref, watch } from '@forinda/kickjs'

const total = computed(() => a.value + b.value)
watch(total, (v) => console.log(v))

batch(() => {
  a.value = 2
  b.value = 2
}) // logs 4 once, not 3 then 4
```

Computed values stay current inside the batch. Batches nest, and the outermost one runs the watchers. `batch` returns what `fn` returns.

### Utilities

```ts
import { isRef, unref, toRef, toRefs } from '@forinda/kickjs'

isRef(count) // true for refs and computed refs
unref(doubled) // unwraps a ref or computed ref; plain values pass through
toRef(state, 'count') // a ref that reads and writes state.count
toRefs(state) // { count: Ref, … }: one live toRef per property
```

`toRef` and `toRefs` are views, not copies. Writing the ref writes the object, and on a `reactive` object, watching the ref follows changes made either way.

## Real-World Example: Request Metrics

```ts
import { ref, computed, watch } from '@forinda/kickjs'
import { createLogger } from '@forinda/kickjs/logger'

const log = createLogger('Metrics')

// Reactive state
const requestCount = ref(0)
const errorCount = ref(0)

// Computed — auto-derives
const errorRate = computed(() =>
  requestCount.value > 0 ? errorCount.value / requestCount.value : 0,
)

// Watch — side effects
watch(errorRate, (rate) => {
  if (rate > 0.1) log.warn(`Error rate: ${(rate * 100).toFixed(1)}%`)
})

// Use in Express middleware
app.use((req, res, next) => {
  requestCount.value++
  res.on('finish', () => {
    if (res.statusCode >= 500) errorCount.value++
  })
  next()
})
```

## Integration with DevTools

The reactivity module powers the [DevTools adapter](./devtools.md). All reactive state is automatically exposed at `/_debug/state` for introspection.

## Differences from Vue

| Feature           | Vue 3            | KickJS                                              |
| ----------------- | ---------------- | --------------------------------------------------- |
| DOM updates       | Yes              | No (backend)                                        |
| `watchEffect`     | Yes              | Not needed — use `watch` with getter                |
| `shallowRef`      | Yes              | `ref` is shallow; `ref(v, { deep: true })` for deep |
| Update timing     | Batched per tick | Synchronous; `batch()` groups writes                |
| Template refs     | Yes              | N/A                                                 |
| `ref.subscribe()` | No               | Yes — direct subscription API                       |
