# @forinda/kickjs-devtools

Development dashboard and introspection endpoints for a KickJS app: routes, the DI container, request metrics, runtime and memory monitoring, jobs, cron, and the plugin/adapter topology. Runs on every HTTP runtime (Express, Fastify, h3).

For a walkthrough of the dashboard and its tabs, see the [DevTools guide](../guide/devtools.md). To add your own tab or publish events to the panel, use [`@forinda/kickjs-devtools-kit`](./devtools-kit.md).

## Install

```bash
pnpm add -D @forinda/kickjs-devtools ws
```

Peer dependencies: `@forinda/kickjs` (`>=8.6.0`) and `ws` (`^8.0.0`, used by the event-bus WebSocket).

## Entry points

| Import path                | Exports                                                               |
| -------------------------- | --------------------------------------------------------------------- |
| `@forinda/kickjs-devtools` | `DevToolsAdapter`, `DevToolsOptions` (type), `RequestLogEntry` (type) |

The package imports `reflect-metadata` itself.

## DevToolsAdapter

The adapter that mounts the dashboard and its JSON endpoints, feeds request counters from the framework's `onResponse` / `onError` hooks, and registers the server-side event bus under `DEVTOOLS_BUS`.

```typescript
const DevToolsAdapter: AdapterFactory<DevToolsOptions, DevToolsAdapterExtensions>
```

Built with `defineAdapter()`. Call it as `DevToolsAdapter({ … })` and pass the result to `bootstrap({ adapters: [...] })`.

```ts
import { bootstrap } from '@forinda/kickjs'
import { DevToolsAdapter } from '@forinda/kickjs-devtools'

bootstrap({
  modules,
  adapters: [
    DevToolsAdapter({
      secret: process.env.DEVTOOLS_SECRET,
      exposeConfig: true,
      configPrefixes: ['APP_', 'DATABASE_'],
    }),
  ],
})
```

### DevToolsOptions

| Field                 | Type                                                              | Default                                                | Description                                                                                                                                                                   |
| --------------------- | ----------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `basePath`            | `string`                                                          | `'/_debug'`                                            | Path the dashboard and every endpoint mount under.                                                                                                                            |
| `enabled`             | `boolean`                                                         | `true` only when `NODE_ENV` is `development` or `test` | When `false`, nothing mounts and a no-op bus is registered under `DEVTOOLS_BUS`.                                                                                              |
| `exposeConfig`        | `boolean`                                                         | `false`                                                | Mount `GET {basePath}/config` with environment variables.                                                                                                                     |
| `configPrefixes`      | `string[]`                                                        | `['APP_', 'NODE_ENV']`                                 | Env var prefixes shown by `/config`; every other value reads `[REDACTED]`.                                                                                                    |
| `onErrorRateExceeded` | `(rate: number) => void`                                          | logs a warning                                         | Called when the server-error rate rises above `errorRateThreshold`.                                                                                                           |
| `errorRateThreshold`  | `number`                                                          | `0.5`                                                  | Error rate (5xx / total requests) that triggers `onErrorRateExceeded`.                                                                                                        |
| `adapters`            | `any[]`                                                           | `[]`                                                   | Peer adapters to read stats from (e.g. `WsAdapter`). Only a fallback: live adapters are read from the application when available.                                             |
| `secret`              | `string \| false`                                                 | random 16-byte hex                                     | Access token. Every endpoint requires it as the `x-devtools-token` header or `?token=` query param. Generated and logged at startup when omitted; `false` disables the guard. |
| `runtime`             | `{ enabled?: boolean; intervalMs?: number; bufferSize?: number }` | `{ enabled: true, intervalMs: 1000, bufferSize: 60 }`  | Runtime sampler settings. With `enabled: false` the `/runtime` and `/memory/stream` endpoints answer 404.                                                                     |
| `requestLog`          | `number`                                                          | `200`                                                  | How many recent requests the Requests tab keeps. `0` keeps none. Requests to `basePath` itself are never logged.                                                              |

### DevToolsAdapterExtensions

The adapter instance carries its reactive state, for tests and peer adapters:

```typescript
interface DevToolsAdapterExtensions {
  readonly requestCount: Ref<number> // all responses
  readonly errorCount: Ref<number> // status >= 500
  readonly clientErrorCount: Ref<number> // status 400–499
  readonly startedAt: Ref<number> // last mount time (ms)
  readonly errorRate: ComputedRef<number> // errorCount / requestCount
  readonly uptimeSeconds: ComputedRef<number> // process uptime
  readonly routeLatency: Record<string, RouteStats> // keyed 'GET /api/v1/users/:id'
  readonly runtimeSampler: RuntimeSampler | null // null when runtime.enabled is false
  readonly memoryAnalyzer: MemoryAnalyzer | null
}
```

`RuntimeSampler` and `MemoryAnalyzer` come from [`@forinda/kickjs-devtools-kit`](./devtools-kit.md#runtimesampler). Unmatched requests share one `<unmatched>` latency bucket per method.

```ts
const devtools = DevToolsAdapter({ secret: false })
// …after some requests
devtools.requestCount.value
devtools.memoryAnalyzer?.health(devtools.runtimeSampler!.history())
```

The adapter also implements `introspect()`, so it appears in its own Topology tab.

## Endpoints

All paths are relative to `basePath` (default `/_debug`) and all are token-guarded unless `secret: false`.

| Method | Path               | Returns                                                                                                                            |
| ------ | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/`                | The dashboard page. The page loads without a token and sends it on its API calls; a `?token=` given here must match.               |
| GET    | `/routes`          | `{ routes }` — every mounted route with its middleware, validation schemas and context-contributor chain.                          |
| GET    | `/source`          | Handler file and line for `?controller=&handler=`; 404 when unknown.                                                               |
| GET    | `/container`       | `{ registrations, count }` — DI registrations (HMR shadow entries excluded).                                                       |
| GET    | `/requests`        | Recent requests as `RequestLogEntry[]`, oldest first; `?since=<seq>` returns only newer entries.                                   |
| GET    | `/metrics`         | Request / error counts, error rate, uptime, and per-route latency with percentiles and a histogram.                                |
| GET    | `/health`          | `healthy` / `degraded` plus each peer adapter's status, refreshed from its `onHealthCheck()` (with a timeout).                     |
| GET    | `/state`           | Snapshot of the reactive state.                                                                                                    |
| GET    | `/runtime`         | Latest `RuntimeSnapshot`, its history, `MemoryHealth`, and process identity (Node version, pid, platform, HTTP runtime).           |
| GET    | `/runtime/stream`  | SSE stream of runtime snapshots.                                                                                                   |
| GET    | `/memory/stream`   | SSE stream of `MemoryHealth`.                                                                                                      |
| POST   | `/memory/snapshot` | Writes a V8 heap snapshot and streams the `.heapsnapshot` file. Blocks the event loop while writing; a concurrent call gets 503.   |
| POST   | `/memory/gc`       | Runs `global.gc()` and returns `{ before, after, reclaimedBytes, elapsedMs }`; 412 unless Node runs with `--expose-gc`.            |
| GET    | `/conditions`      | Which adapters a `when` condition turned off, and why.                                                                             |
| GET    | `/startup`         | Startup timeline — each boot phase and adapter hook.                                                                               |
| GET    | `/tabs`            | Custom tabs collected from every plugin's and adapter's `devtoolsTabs()`.                                                          |
| POST   | `/tabs/run`        | Runs a `launch` tab action: `?tab=&action=`.                                                                                       |
| GET    | `/jobs`            | Job sources — every `jobInspector()` exposed by an adapter or plugin.                                                              |
| GET    | `/jobs/list`       | Jobs: `?source=&queue=&state=&start=&end=` (state defaults to `failed`, at most 100 per page).                                     |
| GET    | `/jobs/job`        | One job: `?source=&queue=&id=`.                                                                                                    |
| POST   | `/jobs/action`     | `?source=&queue=&action=&id=&state=` — `retry`, `remove`, `retryAll`, `clean`, `pause`, `resume`. 501 when the inspector lacks it. |
| GET    | `/cron`            | `{ jobs }` — `@Cron` jobs.                                                                                                         |
| POST   | `/cron/run`        | Runs a cron job now: `?name=`.                                                                                                     |
| GET    | `/topology`        | `TopologySnapshot` — plugins, adapters, contributors and DI tokens, with each `introspect()` result.                               |
| GET    | `/ws`              | WebSocket adapter stats, or `{ enabled: false }` without one.                                                                      |
| GET    | `/queues`          | Queue adapter stats, or `{ enabled: false }` without one.                                                                          |
| GET    | `/graph`           | `{ nodes, edges }` — the DI dependency graph.                                                                                      |
| GET    | `/stream`          | SSE stream of metrics and container changes.                                                                                       |
| GET    | `/config/origins`  | Where each declared config variable's value comes from — names only, so it is served without `exposeConfig`.                       |
| GET    | `/config`          | `{ config, origins }` — env vars filtered by `configPrefixes`. Only mounted with `exposeConfig: true`.                             |
| WS     | `/_bus`            | Event-bus WebSocket the dashboard subscribes to. Attached in `afterStart`; same token guard.                                       |

## RequestLogEntry

One row of `GET /requests`.

```typescript
interface RequestLogEntry {
  seq: number // increasing; a client holding a higher seq knows the app restarted
  at: number // response finish time, ms since epoch
  method: string
  path: string
  route?: string // matched route pattern; absent when unmatched
  status: number
  durationMs: number
  requestId?: string
  error?: { name: string; message: string }
}
```

## See also

- [DevTools guide](../guide/devtools.md)
- [`@forinda/kickjs-devtools-kit`](./devtools-kit.md) — tabs, the event bus, runtime sampler
