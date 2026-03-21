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
import { ref } from '@forinda/kickjs-core'

const count = ref(0)
console.log(count.value) // 0

count.value = 5 // triggers watchers

// Subscribe directly to changes
const unsub = count.subscribe((newVal, oldVal) => {
  console.log(`Changed: ${oldVal} → ${newVal}`)
})
unsub() // cleanup
```

### `computed(getter)`

Creates a lazy, cached derived value that auto-recalculates when dependencies change.

```ts
import { ref, computed } from '@forinda/kickjs-core'

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
import { ref, watch } from '@forinda/kickjs-core'

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

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `immediate` | `boolean` | `false` | Run callback immediately with current value |

### `reactive(object)`

Creates a deeply reactive proxy. Property reads are tracked, writes trigger watchers.

```ts
import { reactive, computed, watch } from '@forinda/kickjs-core'

const metrics = reactive({
  requests: 0,
  errors: 0,
})

const errorRate = computed(() =>
  metrics.requests > 0 ? metrics.errors / metrics.requests : 0,
)

watch(errorRate, (rate) => {
  if (rate > 0.5) alertOncall('Service degraded')
})

// In middleware — just mutate, side effects happen automatically
metrics.requests++
```

### Utilities

```ts
import { isRef, unref, toRefs } from '@forinda/kickjs-core'

isRef(count)   // true for refs, false for everything else
unref(count)   // unwraps ref → value, plain values pass through
toRefs({ a: 1, b: 2 }) // { a: Ref<1>, b: Ref<2> }
```

## Real-World Example: Request Metrics

```ts
import { ref, computed, watch } from '@forinda/kickjs-core'
import { createLogger } from '@forinda/kickjs-core/logger'

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

| Feature | Vue 3 | KickJS |
|---------|-------|--------|
| DOM updates | Yes | No (backend) |
| `watchEffect` | Yes | Not needed — use `watch` with getter |
| `shallowRef` | Yes | Not needed — use `ref` |
| Template refs | Yes | N/A |
| `ref.subscribe()` | No | Yes — direct subscription API |
