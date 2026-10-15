# @forinda/kickjs-devtools-kit

Types, tab factories, the runtime event bus, and the runtime sampler / memory analyzer that [`@forinda/kickjs-devtools`](./devtools.md) is built on. Plugins and adapters depend on this package — not on the DevTools runtime — to contribute tabs, report jobs, describe themselves, and publish events to the panel.

For how custom tabs show up in the dashboard, see the [DevTools guide](../guide/devtools.md).

## Install

```bash
pnpm add @forinda/kickjs-devtools-kit
```

Peer dependency: `@forinda/kickjs` (`>=5.18.0`), only needed by the `./bus/token` entry.

## Entry points

| Import path                              | Contents                                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| `@forinda/kickjs-devtools-kit`           | Everything below except `createBusCore` and the `./bus/token` exports.                      |
| `@forinda/kickjs-devtools-kit/types`     | Protocol types, `PROTOCOL_VERSION`, `defineDevtoolsTab` — no runtime imports.               |
| `@forinda/kickjs-devtools-kit/runtime`   | `RuntimeSampler`, `MemoryAnalyzer`, `heapGrowthBytesPerSec` and their option types (Node).  |
| `@forinda/kickjs-devtools-kit/bus`       | Bus types, `createInMemoryBus`, `createBusCore`, `createBrowserBus` — browser-safe.         |
| `@forinda/kickjs-devtools-kit/bus/token` | `DEVTOOLS_BUS`, `getActiveDevtoolsBus`, `setActiveDevtoolsBus` — imports `@forinda/kickjs`. |

`DEVTOOLS_BUS` lives in its own entry so browser code that imports `./bus` never pulls in the framework.

## Tabs

A plugin or adapter contributes tabs from a `devtoolsTabs()` method; DevTools collects them at `GET /_debug/tabs`.

### defineDevtoolsTab

Identity factory for a descriptor-based tab.

```typescript
function defineDevtoolsTab(spec: DevtoolsTabDescriptor): DevtoolsTabDescriptor

interface DevtoolsTabDescriptor {
  id: string // stable id, used in the URL hash
  title: string
  icon?: string // Iconify-style id or absolute URL
  category?: 'app' | 'modules' | 'observability' | 'debug' | (string & {})
  view: DevtoolsTabView
}

type DevtoolsTabView =
  | { type: 'iframe'; src: string } // embed a URL the plugin serves
  | { type: 'launch'; actions: ReadonlyArray<DevtoolsTabAction> } // buttons run on the server
  | { type: 'module'; src: string } // browser ES module, same origin
  | { type: 'html'; html: string } // inline HTML — trusted source only

interface DevtoolsTabAction {
  id: string
  label: string
  description?: string
  run?: () => unknown // result (JSON) is shown under the buttons; a throw shows the error
}
```

```ts
import { defineAdapter } from '@forinda/kickjs'
import { defineDevtoolsTab } from '@forinda/kickjs-devtools-kit'

export const CacheAdapter = defineAdapter({
  name: 'CacheAdapter',
  build: () => ({
    devtoolsTabs: () => [
      defineDevtoolsTab({
        id: 'cache',
        title: 'Cache',
        view: {
          type: 'launch',
          actions: [{ id: 'flush', label: 'Flush cache', run: () => cache.flush() }],
        },
      }),
    ],
  }),
})
```

A `module` view's default export is a `defineDevtoolsRenderTab(...)` spec or a bare `render(el, props)` function.

### defineDevtoolsRenderTab

Identity factory for a render-function tab. The panel calls `render(el, props)` on mount and the returned function on unmount.

```typescript
function defineDevtoolsRenderTab<TProps = TabProps>(
  spec: DevtoolsRenderTab<TProps>,
): DevtoolsRenderTab<TProps>

interface DevtoolsRenderTab<TProps = TabProps> {
  id: string
  name: string | ((el: HTMLElement) => void)
  badge?: () => string | number | null
  render: (el: HTMLElement, props: TProps) => void | (() => void)
  defaultOpen?: boolean // default false
}

interface TabProps {
  bus: KickEventBus
  config: TabRuntimeConfig
  query: URLSearchParams // URL hash state
}

interface TabRuntimeConfig {
  theme: 'dark' | 'light'
  panelHeight: number
}
```

```ts
import { defineDevtoolsRenderTab } from '@forinda/kickjs-devtools-kit'

export default defineDevtoolsRenderTab({
  id: 'slow-queries',
  name: 'Slow queries',
  render(el, { bus }) {
    const list = document.createElement('ul')
    el.append(list)
    return bus.on('db:slow-query', (q) => {
      const li = document.createElement('li')
      li.textContent = `${q.durationMs}ms ${q.sql}`
      list.append(li)
    })
  },
})
```

## Event bus

### KickEventBus

The bus every tab and emitter uses, on the server and in the browser.

```typescript
interface KickEventBus {
  on<K extends EventTypeKey>(type: K, handler: (payload: EventPayload<K>) => void): Unsubscribe
  on(type: string, handler: (payload: unknown) => void): Unsubscribe
  emit<K extends EventTypeKey>(type: K, payload: EventPayload<K>): void
  emit(type: string, payload: unknown): void
  onAny(handler: (event: KickDevtoolsEvent) => void): Unsubscribe // full envelope
}

interface KickDevtoolsEvent<T = unknown> {
  type: string
  payload: T
  pluginId?: string // e.g. 'kick/db'
  ts: number // stamped by the bus on emit (epoch ms)
}

type Unsubscribe = () => void
type KickDevtoolsEventName = string
type EventTypeKey = keyof KickDevtoolsEventRegistry & string
type EventPayload<K extends EventTypeKey> = KickDevtoolsEventRegistry[K]
```

### KickDevtoolsEventRegistry

Empty interface; augment it to type your events. Unregistered names still work with `payload: unknown`.

```ts
declare module '@forinda/kickjs-devtools-kit' {
  interface KickDevtoolsEventRegistry {
    'db:slow-query': { sql: string; durationMs: number }
  }
}
```

### createInMemoryBus

A single-process bus. Handler exceptions are caught and logged, so one subscriber can't break the others.

```typescript
function createInMemoryBus(): KickEventBus
```

### createBusCore

The dispatcher underneath the in-memory and browser buses. Exported from `./bus` only.

```typescript
function createBusCore(): BusCore

interface BusCore {
  on(type: string, handler: (payload: unknown) => void): Unsubscribe
  onAny(handler: (event: KickDevtoolsEvent) => void): Unsubscribe
  dispatch(event: KickDevtoolsEvent): void // keeps the caller's ts / pluginId
}
```

### createBrowserBus

A browser bus with optional cross-tab fan-out (BroadcastChannel) and a WebSocket to the server bus. Remote events are dispatched locally but never re-broadcast.

```typescript
function createBrowserBus(opts?: BrowserBusOptions): KickEventBus
```

| Field            | Type              | Default           | Description                                                                        |
| ---------------- | ----------------- | ----------------- | ---------------------------------------------------------------------------------- |
| `channel`        | `string \| false` | `'kick-devtools'` | BroadcastChannel name; `false` disables cross-tab fan-out.                         |
| `wsUrl`          | `string`          | —                 | Server bus URL (DevTools serves it at `{basePath}/_bus`). Omit to skip the socket. |
| `reconnectMs`    | `number`          | `500`             | Reconnect delay per attempt (`attempt * reconnectMs`).                             |
| `reconnectMaxMs` | `number`          | `5000`            | Upper bound on the reconnect delay.                                                |

### DEVTOOLS_BUS

From `@forinda/kickjs-devtools-kit/bus/token`. The DevTools adapter registers its server bus under this token in `beforeMount`; when DevTools is disabled a no-op bus is registered instead.

```typescript
const DEVTOOLS_BUS: InjectionToken<KickEventBus> // 'kick/devtools/bus'
function getActiveDevtoolsBus(): KickEventBus | undefined
function setActiveDevtoolsBus(bus: KickEventBus | undefined): void
```

`getActiveDevtoolsBus()` returns the bus while the DevTools adapter runs, for code that can't reach the container (a client created at import time). `setActiveDevtoolsBus` is called by the adapter.

```ts
import { getActiveDevtoolsBus } from '@forinda/kickjs-devtools-kit/bus/token'

export function reportDone(id: string) {
  // undefined unless the DevTools adapter is running
  getActiveDevtoolsBus()?.emit('report:done', { id })
}
```

Resolving `DEVTOOLS_BUS` from the container works too, once the DevTools adapter's `beforeMount` has run.

## Introspection

### IntrospectFn

An adapter or plugin implements `introspect()` to describe itself in the Topology tab. Without it, it appears as `{ name, kind }`.

```typescript
type IntrospectFn = () => IntrospectionSnapshot | Promise<IntrospectionSnapshot>

interface IntrospectionSnapshot {
  protocolVersion: typeof PROTOCOL_VERSION
  name: string // matches definePlugin / defineAdapter name
  kind: IntrospectionKind // 'plugin' | 'adapter' | 'middleware' | 'contributor'
  version?: string
  state?: Record<string, unknown> // small, JSON-serialisable
  tokens?: { provides: readonly string[]; requires: readonly string[] }
  metrics?: Record<string, number>
  memoryBytes?: number
  hooks?: readonly LifecycleHook[] // filled in by DevTools
  dependsOn?: readonly string[] // filled in by DevTools
}
```

Keep `state` and `metrics` cheap to compute — DevTools polls the topology.

```ts
introspect: () => ({
  protocolVersion: PROTOCOL_VERSION,
  name: 'CacheAdapter',
  kind: 'adapter',
  metrics: { entries: cache.size },
})
```

`LifecycleHook` is the union of adapter / plugin hook names (`'register'`, `'beforeMount'`, `'afterStart'`, `'shutdown'`, …).

### TopologySnapshot

Returned by `GET /_debug/topology`.

```typescript
interface TopologySnapshot {
  protocolVersion: typeof PROTOCOL_VERSION
  timestamp: number
  plugins: IntrospectionSnapshot[] // mount order
  adapters: IntrospectionSnapshot[] // mount order
  contributors: TopologyContributorEntry[] // { key, source, dependsOn }
  diTokens: TopologyTokenEntry[] // { token, scope, kind, instantiated }
  errors: readonly TopologyError[] // { name, kind, message } per failed introspect()
}

type TopologyContributorSource = 'method' | 'class' | 'module' | 'adapter' | 'plugin' | 'global'
```

### PROTOCOL_VERSION

```typescript
const PROTOCOL_VERSION: 1
```

Bumped when a snapshot shape changes incompatibly; additive optional fields don't bump it.

## Jobs

### JobInspector

Expose one from a `jobInspector()` method on an adapter or plugin and the Queues tab can browse and manage its jobs. `@forinda/kickjs-queue` implements it for BullMQ; any other runner can implement the same methods.

```typescript
interface JobInspector {
  queues(): Promise<JobQueueInfo[]>
  jobs(queue: string, state: JobState, range: { start: number; end: number }): Promise<JobSummary[]>
  job(queue: string, id: string): Promise<JobDetail | null>
  retry?(queue: string, id: string): Promise<void>
  remove?(queue: string, id: string): Promise<void>
  retryAll?(queue: string): Promise<number | void>
  clean?(queue: string, state: JobState): Promise<number>
  pause?(queue: string): Promise<void>
  resume?(queue: string): Promise<void>
}

type JobState = 'waiting' | 'active' | 'delayed' | 'completed' | 'failed' | 'paused'

interface JobQueueInfo {
  name: string
  counts: Partial<Record<JobState, number>> // omitted = unknown, not zero
  paused?: boolean
}

interface JobSummary {
  id: string
  name: string
  state: JobState
  attempts: number
  maxAttempts?: number
  createdAt?: number
  finishedAt?: number
  failedReason?: string
}

interface JobDetail extends JobSummary {
  data: unknown
  result?: unknown
  stacktrace?: string[]
  processedAt?: number
  delayMs?: number
  progress?: unknown
  options?: Record<string, unknown>
}
```

`jobs()` returns jobs newest first, `start`–`end` inclusive and 0-based. Optional actions you leave out are answered with 501 by DevTools.

## Runtime monitoring

Node-only. Also available from `@forinda/kickjs-devtools-kit/runtime`.

### RuntimeSampler

Samples memory, CPU, event-loop delay and GC on an interval into a ring buffer.

```typescript
class RuntimeSampler {
  constructor(opts?: RuntimeSamplerOptions)
  start(): void // idempotent
  stop(): void // tears down observers and clears the buffer
  latest(): RuntimeSnapshot | null
  history(): RuntimeSnapshot[]
  takeSample(): RuntimeSnapshot
  isRunning(): boolean
}
```

| Field                   | Type     | Default | Description                                   |
| ----------------------- | -------- | ------- | --------------------------------------------- |
| `intervalMs`            | `number` | `1000`  | Sample interval.                              |
| `bufferSize`            | `number` | `60`    | Number of past samples kept.                  |
| `eventLoopResolutionMs` | `number` | `20`    | Resolution of the event-loop-delay histogram. |

```typescript
interface RuntimeSnapshot {
  protocolVersion: typeof PROTOCOL_VERSION
  timestamp: number
  uptimeSec: number
  memory: NodeJS.MemoryUsage
  cpu: { userMicros: number; systemMicros: number } // delta since previous sample
  eventLoop: { p50: number; p95: number; p99: number; max: number } // ms
  gc: { count: number; totalPauseMs: number }
}
```

### MemoryAnalyzer

Derives a memory-health signal from a window of snapshots plus GC reclaim history and active handles.

```typescript
class MemoryAnalyzer {
  constructor(opts?: MemoryAnalyzerOptions)
  start(): void // starts the GC observer; idempotent
  stop(): void
  gcReclaimRatio(): number
  health(window: readonly RuntimeSnapshot[]): MemoryHealth
  static heapGrowthBytesPerSec(window: readonly RuntimeSnapshot[]): number
  static activeHandlesByType(): Record<string, number>
}

function heapGrowthBytesPerSec(window: readonly RuntimeSnapshot[]): number
```

| Field              | Type                                                       | Default                                                     | Description                                                                                                            |
| ------------------ | ---------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `growthThresholds` | `{ warnBytesPerSec: number; criticalBytesPerSec: number }` | `{ warnBytesPerSec: 87_381, criticalBytesPerSec: 349_525 }` | Heap growth that flips severity to `warn` (5 MB/min) and `critical` (20 MB/min).                                       |
| `gcWindow`         | `number`                                                   | `20`                                                        | GC entries kept for the reclaim ratio.                                                                                 |
| `warmup`           | `{ skipFirstSec: number; minSpanSec: number }`             | `{ skipFirstSec: 30, minSpanSec: 20 }`                      | Ignore samples from the first `skipFirstSec` of uptime; report `sampling: true` until `minSpanSec` of history remains. |

```typescript
interface MemoryHealth {
  protocolVersion: typeof PROTOCOL_VERSION
  heapGrowthBytesPerSec: number
  heapGrowthSeverity: 'ok' | 'warn' | 'critical'
  sampling?: boolean // too little settled history to judge yet
  gcReclaimRatio: number
  activeHandles: number
  handlesByType: Record<string, number>
  heapUtilization: number // heap used / heap_size_limit
}
```

```ts
import { RuntimeSampler, MemoryAnalyzer } from '@forinda/kickjs-devtools-kit/runtime'

const sampler = new RuntimeSampler({ intervalMs: 5000 })
const analyzer = new MemoryAnalyzer()
sampler.start()
analyzer.start()

setInterval(() => {
  const health = analyzer.health(sampler.history())
  if (health.heapGrowthSeverity === 'critical') console.warn('heap is growing fast')
}, 60_000)
```

## RPC envelopes

Shared request / response shapes for DevTools transports.

```typescript
interface RpcRequest<TParams = unknown> {
  id: string
  method: string
  params?: TParams
}

type RpcResponse<TResult = unknown> = RpcSuccess<TResult> | RpcFailure

interface RpcSuccess<TResult = unknown> {
  id: string
  result: TResult
  error?: never
}

interface RpcFailure {
  id: string
  result?: never
  error: RpcError
}

interface RpcError {
  code: string // e.g. 'RPC_NOT_FOUND'
  message: string
  data?: unknown
}
```

## See also

- [`@forinda/kickjs-devtools`](./devtools.md) — the adapter and its endpoints
- [DevTools guide](../guide/devtools.md)
