# DevTools Adapter

The DevTools adapter provides Vue-style reactive introspection for KickJS applications. It exposes debug endpoints that let you inspect routes, DI container state, request metrics, and application health — all powered by the [reactivity module](./reactivity.md).

## Quick Start

```ts
import { bootstrap } from '@forinda/kickjs'
import { DevToolsAdapter } from '@forinda/kickjs-devtools'

bootstrap({
  modules: [UserModule, ProductModule],
  adapters: [
    DevToolsAdapter({
      enabled: process.env.NODE_ENV !== 'production',
    }),
  ],
})
```

DevTools endpoints are now available at `/_debug/*`.

### Stripping DevTools from production bundles

The runtime `enabled` flag above keeps the DevTools adapter inert in prod, but the import of `@forinda/kickjs-devtools` is still in the bundle — code, dependencies, and all. To drop the package entirely from the production output, gate the import behind the `__KICKJS_DEVTOOLS__` build-time flag injected by `@forinda/kickjs-vite`:

```ts
/// <reference types="@forinda/kickjs-vite/globals" />
import { bootstrap } from '@forinda/kickjs'

const adapters = [/* prod adapters… */]

if (__KICKJS_DEVTOOLS__) {
  const { DevToolsAdapter } = await import('@forinda/kickjs-devtools')
  adapters.push(DevToolsAdapter({ basePath: '/_debug' }))
}

bootstrap({ modules: [UserModule, ProductModule], adapters })
```

Vite/Rollup substitutes `__KICKJS_DEVTOOLS__` with `true` (during `vite dev`) or `false` (during `vite build`) and tree-shakes the unreachable branch — including the dynamic `import('@forinda/kickjs-devtools')` chunk — out of the prod bundle entirely.

The `kickjsVitePlugin()` registers the flag by default. Override per build via the env var `KICKJS_DEVTOOLS=0|1` or per project via plugin options:

```ts
// vite.config.ts
import { kickjsVitePlugin } from '@forinda/kickjs-vite'

export default defineConfig({
  plugins: [
    kickjsVitePlugin({
      // Force-disable for a "no-devtools" build profile
      devtools: { enabled: false },
      // Or rename the global to avoid collisions:
      // devtools: { flagName: '__APP_DEVTOOLS__' },
      // Or skip the plugin entirely:
      // devtools: false,
    }),
  ],
})
```

Resolution order: explicit `enabled` option → `KICKJS_DEVTOOLS=0|1|true|false` env → Vite `command` (`'serve'` → `true`, `'build'` → `false`).

## Endpoints

### `GET /_debug/routes`

Lists all registered routes with their HTTP method, path, controller, handler, middleware, and
resolved [route flags](./route-flags.md). A handler with `@FileUpload` also reports `upload`
(`mode`, `fieldName`, `maxCount`; never `allowedTypes`, which may be a function).

```json
{
  "routes": [
    {
      "method": "GET",
      "path": "/api/v1/users",
      "controller": "UserController",
      "handler": "getAll",
      "middleware": ["authGuard"],
      "flags": {}
    },
    {
      "method": "GET",
      "path": "/api/v1/health",
      "controller": "HealthController",
      "handler": "live",
      "middleware": [],
      "flags": { "auth.public": true }
    },
    {
      "method": "POST",
      "path": "/api/v1/login",
      "controller": "AuthController",
      "handler": "login",
      "middleware": ["validate"],
      "flags": { "rate.limit": { "rpm": 10 } }
    }
  ]
}
```

`flags` holds only the flags in force: one turned off at the method (`@Public(false)`) is absent
rather than `false`, matching what every other consumer sees. The dashboard's Routes tab shows the
same values in a Flags column, so "why does this endpoint not require auth" is answerable from the
route list instead of by reading the controller.

### `GET /_debug/container`

Shows all DI container registrations with their scope and instantiation status.

```json
{
  "registrations": [
    { "token": "UserService", "scope": "singleton", "instantiated": true },
    { "token": "ProductService", "scope": "singleton", "instantiated": false }
  ],
  "count": 2
}
```

### `GET /_debug/requests`

The last `requestLog` requests (default 200), oldest first. `?since=<seq>` returns only the newer ones. The dashboard's own `/_debug` calls aren't logged. Query strings, headers and bodies aren't recorded.

```json
{
  "requests": [
    {
      "seq": 41,
      "at": 1790000000000,
      "method": "GET",
      "path": "/api/v1/users/42",
      "route": "/api/v1/users/:id",
      "status": 500,
      "durationMs": 6.6,
      "requestId": "6dda727c-…",
      "error": { "name": "TypeError", "message": "users store unavailable" }
    }
  ]
}
```

### `GET /_debug/metrics`

Live request metrics powered by reactive refs and computed values.

```json
{
  "requests": 1542,
  "serverErrors": 3,
  "clientErrors": 28,
  "errorRate": 0.0019,
  "uptimeSeconds": 3600,
  "startedAt": "2026-03-20T10:00:00.000Z",
  "routeLatency": {
    "GET /api/v1/users": {
      "count": 500,
      "totalMs": 2500,
      "minMs": 2,
      "maxMs": 45
    }
  }
}
```

### `GET /_debug/health`

Deep health check with computed status derived from reactive error rate.

```json
{
  "status": "healthy",
  "errorRate": 0.0019,
  "uptime": 3600,
  "adapters": {
    "DevToolsAdapter": "running"
  }
}
```

Returns `200` when healthy, `503` when degraded (error rate exceeds threshold).

### `GET /_debug/ws`

WebSocket stats when `WsAdapter` is active. Shows namespaces, connections, message counts, and rooms.

```json
{
  "enabled": true,
  "totalConnections": 42,
  "activeConnections": 12,
  "messagesReceived": 1580,
  "messagesSent": 3200,
  "errors": 0,
  "namespaces": {
    "/ws/chat": { "connections": 8, "handlers": 10 },
    "/ws/notifications": { "connections": 4, "handlers": 4 }
  },
  "rooms": {
    "/ws/chat": ["room:general", "room:support"]
  }
}
```

Returns `404` if no `WsAdapter` is registered.

### `GET /_debug/state`

Full reactive state snapshot — everything in one endpoint.

```json
{
  "reactive": {
    "requestCount": 1542,
    "errorCount": 3,
    "clientErrorCount": 28,
    "errorRate": 0.0019,
    "uptimeSeconds": 3600,
    "startedAt": "2026-03-20T10:00:00.000Z"
  },
  "routes": 12,
  "container": 8,
  "routeLatency": {}
}
```

### `GET /_debug/config` (opt-in)

Sanitized environment variables. Only variables matching configured prefixes are shown; everything else is `[REDACTED]`.

```json
{
  "config": {
    "APP_NAME": "my-api",
    "APP_PORT": "3000",
    "NODE_ENV": "development",
    "DATABASE_URL": "[REDACTED]",
    "JWT_SECRET": "[REDACTED]"
  }
}
```

## Configuration

```ts
DevToolsAdapter({
  // Base path for debug endpoints (default: '/_debug')
  basePath: '/_debug',

  // Only enable when true (default: process.env.NODE_ENV !== 'production')
  enabled: process.env.NODE_ENV !== 'production',

  // Expose sanitized env vars at /_debug/config (default: false)
  exposeConfig: true,

  // Env var prefixes to expose (default: ['APP_', 'NODE_ENV'])
  configPrefixes: ['APP_', 'DATABASE_', 'NODE_ENV'],

  // Error rate threshold for health degradation (default: 0.5)
  errorRateThreshold: 0.5,

  // Custom callback when error rate exceeds threshold
  onErrorRateExceeded: (rate) => {
    slackWebhook.send(`Error rate: ${(rate * 100).toFixed(1)}%`)
  },

  // Recent requests the Requests tab keeps (default: 200; 0 keeps none)
  requestLog: 200,
})
```

## Accessing Reactive State Programmatically

The adapter exposes its reactive state as public properties, so you can compose with it:

```ts
const devtools = DevToolsAdapter()

// Read reactive values
console.log(devtools.requestCount.value)
console.log(devtools.errorRate.value)

// Watch for changes
import { watch } from '@forinda/kickjs'

watch(devtools.errorRate, (rate) => {
  if (rate > 0.1) pagerDuty.alert('High error rate')
})

// Subscribe directly
devtools.requestCount.subscribe((newCount) => {
  prometheus.gauge('http_requests_total').set(newCount)
})
```

## How It Works

The DevToolsAdapter uses three layers:

1. **Reactive primitives** (`ref`, `computed`, `watch`) from `@forinda/kickjs/reactivity`
2. **Middleware** that increments reactive counters on each request (phase: `beforeGlobal`)
3. **Routes** at `/_debug/*`, registered through the engine-neutral adapter HTTP surface, that read reactive state and return JSON. They run the same on Express, Fastify, and h3

Because the state is reactive, the computed values (error rate, uptime) are always consistent and only recalculate when their dependencies change.

## Browser Dashboard

When you visit `/_debug` in a browser, the DevTools adapter serves a single-page dashboard built with Solid + Tailwind. It connects to the JSON endpoints documented above and adds live UI on top — there's nothing to install client-side.

### Connection state

A pill in the global header shows what the dashboard is doing:

| State                     | Meaning                                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| **Live** (green pulse)    | Subscribed to `/stream` SSE — metrics + container changes push in real time                     |
| **Polling** (amber pulse) | SSE dropped, falling back to a 5-second `/health` + `/metrics` poll                             |
| **Connecting…** (grey)    | First request hasn't returned yet                                                               |
| **Disconnected** (red)    | The app isn't answering (restarting, crashed) — a banner shows and the dashboard keeps retrying |

The trailing `Updated HH:MM:SS` timestamp is the last successful refresh, so you can tell at a glance the page isn't frozen.

### Tabs

Each tab subscribes to a slice of the shared store; nothing owns its own polling loop.

| Tab           | What it shows                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Overview**  | Requests, server errors, p95 latency and heap, each with the last minute as a sparkline; the latest failed requests with their errors (click one to open it in **Requests**); app status, uptime, WebSocket and adapters with status dots. Default tab on first visit.                                                                                                                                                                                                      |
| **Runtime**   | The Node process: engine, Node version, PID and uptime; heap, process memory, event-loop delay (with GC ticks) and CPU over the last minute; memory health — heap growth per minute, GC reclaim, share of the heap limit, open handles by type — and **Heap snapshot** / **Run GC**. Growth is judged after startup settles, so a fresh process reads `sampling`, not a leak.                                                                                               |
| **Topology**  | Plugins, adapters and context contributors side by side. Each plugin / adapter card shows its version, the counters and state its `introspect()` reports, and the DI tokens it provides and requires — hover a token to light up every card that touches it, click it to open it in **Container**. Contributors show their `ctx` key, source and what they run after.                                                                                                       |
| **Routes**    | Every route, grouped by controller, with its flags — searchable, filterable by method. Selecting one opens the [API runner](#api-runner) beside the list.                                                                                                                                                                                                                                                                                                                   |
| **Requests**  | The app's recent requests, newest first — status, method, path, duration, and the error a failed one threw. Filter by status class; select one for its route and request ID, and **Replay in runner** to reopen it with the same path params.                                                                                                                                                                                                                               |
| **Metrics**   | One row per route: calls, share of 5xx, p50 / p95 / p99 and max, sortable by any column. Pick a percentile to bar it against the slowest route; durations turn amber, orange and red past 200 ms, 500 ms and 1 s. Expand a row for its latency histogram, ok / 4xx / 5xx counts, and **Try in runner**.                                                                                                                                                                     |
| **Container** | Every DI registration — search, and filter by kind and scope (each chip shows how many it would match). Rows show a status dot, kind, resolve count and when the token was last resolved. Selecting one shows its dependencies and dependents (click to follow), resolve stats and `@PostConstruct` outcome beside the list.                                                                                                                                                |
| **Database**  | The queries kick/db reports while DevTools is installed. **Slowest** groups statements that differ only in their values (calls, failures, mean, p95 with a bar, total time — sortable); **Recent** is the raw log. Select either for the full SQL, numbered parameters and the error. Durations turn amber past 50 ms.                                                                                                                                                      |
| **Queues**    | Per-queue cards (waiting / active / completed / failed / delayed / paused) when `@forinda/kickjs-queue` is mounted.                                                                                                                                                                                                                                                                                                                                                         |
| **Graph**     | The DI dependency graph on a canvas, in columns from what nothing depends on (usually controllers) to leaves. Drag tokens to arrange them (remembered per browser; **Reset layout** undoes it), drag the background or scroll to pan, ⌘/Ctrl + scroll or pinch to zoom, **Fit** to frame everything. Select a token to keep its whole chain in focus with its details beside the graph; type a name and press Enter to jump to it. Edges that close a cycle are dashed red. |
| **Activity**  | The live event-bus stream, newest first: kick/db queries, queue jobs, and anything emitted on `DEVTOOLS_BUS`. Toggle namespaces (the part of the type before `:`, each chip with its count) or search type and payload; error and warning events are tinted. Scrolling down holds the list still, and **N new** jumps back to the latest. Select an event for its full payload.                                                                                             |

### Custom tabs

An adapter or plugin adds its own sidebar tab with `devtoolsTabs()`. The descriptor type and `defineDevtoolsTab` come from the kit, which `@forinda/kickjs` doesn't depend on — add it to the package that declares the tab:

<PmCommand add="@forinda/kickjs-devtools-kit" />

```ts
import { defineAdapter } from '@forinda/kickjs'
import { defineDevtoolsTab } from '@forinda/kickjs-devtools-kit'

export const AuditAdapter = defineAdapter({
  name: 'AuditAdapter',
  build: () => ({
    devtoolsTabs() {
      return [
        defineDevtoolsTab({
          id: 'audit',
          title: 'Audit',
          // Or an iframe of a page the app serves: { type: 'iframe', src: '/_audit/panel' }
          view: { type: 'html', html: '<p>12 events today</p>' },
        }),
      ]
    },
  }),
})
```

The tab appears at the bottom of the sidebar. `kick g adapter` and `kick g plugin` write this hook commented out. A tab's `view` is one of:

| `view.type` | Shows                                                                                                                             |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `html`      | Markup, injected as-is — only markup you control                                                                                  |
| `iframe`    | A page at `src`. On the app's own origin it gets the dashboard token as `?token=`, so it can call `/_debug`; elsewhere it doesn't |
| `launch`    | Buttons; each runs its `run()` on the server and shows what it returns                                                            |
| `module`    | A browser module from the app's own origin, mounted into the tab                                                                  |

Buttons — `run()` executes in the app process, behind the DevTools token:

```ts
view: {
  type: 'launch',
  actions: [
    { id: 'flush', label: 'Flush cache', run: async () => ({ removed: await cache.clear() }) },
  ],
}
```

A module tab is for live content. Serve a file and point the tab at it:

```ts
build: () => ({
  beforeMount({ http }) {
    http.serveStatic('/_audit', new URL('./panel', import.meta.url).pathname)
  },
  devtoolsTabs: () => [
    defineDevtoolsTab({ id: 'audit', title: 'Audit', view: { type: 'module', src: '/_audit/tab.js' } }),
  ],
}),
```

```js
// panel/tab.js — the default export is a defineDevtoolsRenderTab(...) spec, or just a render function
export default {
  render(el, { bus, config }) {
    const list = document.createElement('ul')
    el.append(list)
    const off = bus.on('audit:entry', (entry) => {
      const li = document.createElement('li')
      li.textContent = `${entry.actor} ${entry.action}`
      list.prepend(li)
    })
    return off // runs when the tab closes
  },
}
```

The server emits `audit:entry` on the same bus — `@Inject(DEVTOOLS_BUS) bus` (from `@forinda/kickjs-devtools-kit/bus/token`), then `bus.emit('audit:entry', { actor, action })`.

`render(el, props)` gets the dashboard's event `bus`, `config` (`theme`, `panelHeight`) and the page's `query`; what it returns runs when the tab unmounts. A module from another origin is refused — it would run with the dashboard's token.

### API runner

Selecting a route on the Routes tab opens the runner beside the list — drag the divider to resize; the width is remembered. The bar at its top shows the method and resolved URL with **Send**. It sends a request to that route, from the browser, on the same origin — so it behaves the same on Express, Fastify and h3, and needs no extra endpoint. Each part of the request is a collapsible section:

- **Path params** — one field per `:param`; the resolved URL updates as you type.
- **Query** and **Headers** — key/value rows you can switch off without deleting.
- **Body** — for `POST` / `PUT` / `PATCH` / `DELETE`, either **Raw** text (JSON gets `Content-Type: application/json`) or **Form data**: `multipart/form-data` rows that are text fields or **file pickers**. A route with `@FileUpload` opens in form mode with its declared field ready, and says how many files it takes. Picked files are kept in memory only, so pick them again after reopening; the snippets use `-F 'field=@file'` (curl) and a `FormData` (fetch).
- **Environment** — default headers sent with every route (an `Authorization` token, a tenant header), variables, and settings. Kept for the browser tab only, unless you tick **Remember on this browser** (see below).
- **Code snippet** — the request as `curl` or `fetch`, rendered so you can read and select it; **Copy** is a shortcut.
- **Response** — status, time, headers and the body (JSON pretty-printed), plus **Save to variable**.
- **History** — the last 30 requests across all routes, with status and time. Click one to reopen its route with the inputs it was sent with. Entries keep `{{variables}}` as written, not their values.

The header names the handler (`UsersController.list`): click it to **open the handler in your editor**. The dashboard asks the app where the class is declared under `src/`, then follows a `vscode://file{file}:{line}` link. For another editor, change **Editor link** under _Environment → Settings_ — e.g. `cursor://file{file}:{line}`, `windsurf://file{file}:{line}`, or `idea://open?file={file}&line={line}`.

#### OpenAPI prefill

When the [Swagger adapter](./swagger.md) serves a spec (`/openapi.json` by default; change **OpenAPI spec URL** in settings if yours differs), the runner reads the route's operation:

- a route opened for the first time gets its query parameters as rows (switched on when required) and an example JSON body built from the request schema — `example`, `default` or the first `enum` value where the schema gives one, a blank of the right type otherwise;
- the summary shows under the route, path-param descriptions show as placeholders, and query parameters are listed with their descriptions;
- **Fill empty inputs from OpenAPI** (under _Environment_) applies it later. It only fills empty fields and adds missing query rows — it never overwrites what you typed.

#### Variables and saved auth

Like environments in Postman or Insomnia, variables save you re-typing the same values:

- Write `{{name}}` in any param, query, header or body value, and set `name` under _Environment → Variables_. A `{{name}}` with no value is left as written and flagged under the URL.
- **Save to variable** on a response reads a JSON path (`accessToken`, `data.token`, `items[0].id`) and sets a variable from it.
- Together: send your login route once, save `data.accessToken` as `token`, and add a default header `Authorization: Bearer {{token}}` — every route now sends it, and logging in again updates it everywhere.
- **Remember on this browser** keeps default headers and variables in `localStorage`, so they survive closing the tab. They often hold tokens: leave it off on a shared machine. Switching it moves them rather than copying.

It handles the framework's conventions for you:

- **CSRF** — for unsafe methods it reads the `_csrf` cookie and sends it as `x-csrf-token`, the `csrf()` / `csrfGuard()` defaults. Change the names under _Environment → Settings_ if your app overrides them.
- **Public routes** — on a route carrying a public [route flag](./route-flags.md), a default `Authorization` header is left out, so you see the route work without credentials. The flag name defaults to `auth.public`; list several (comma-separated) if your app uses more than one.
- **Data-changing requests** — `DELETE`, `PUT` and `PATCH` need a second click before they are sent. They run against whatever the app is connected to.
- **The devtools token is never sent** to your routes.

Per-route inputs are saved in `localStorage`. Routes mounted through a hand-built `router` carry no route metadata, so they aren't listed.

### Layout

The sidebar is a column of icons — hover for the tab's name, and the small numbers are counts (routes, DI tokens). The arrow at its foot shows labels instead; the choice is remembered. When the app stops answering (a restart, a crash), a banner says so and the dashboard keeps retrying until it's back.

### Command palette

Press <kbd>⌘K</kbd> / <kbd>Ctrl+K</kbd> (or <kbd>/</kbd> outside a text field), or click **Search** in the header. Type to find a tab, a route (opens it in the API runner), or a DI token (opens its detail), or to switch theme and density. Arrow keys move, Enter runs, Escape closes.

### Token details

Selecting a token — in **Container**, from the command palette, or in **Graph** — shows its kind, scope and status, what it depends on and what uses it (click either to follow the chain), how often and when it was resolved, and its `@PostConstruct` outcome.

### Beginner-friendly tooltips

Most metric labels carry a small ⓘ icon — hover for a one-line definition. Denser panels (Memory's "Leak risk", PostConstruct status) open a modal with the full explanation, severity bucket boundaries, and worked examples. Wording lives in `lib/info.tsx`'s `METRIC_DEFS` registry.

### Auth gate

If the server runs `DevToolsAdapter({ requireToken: true })` and you open the dashboard without a `?token=…` query param OR the `kickjs_devtools_token` cookie, a paste-token modal appears. The token is validated against `/health`, then persisted to a 30-day cookie. Subsequent visits skip the prompt.

### VSCode extension

The same `/_debug/*` JSON endpoints power the [KickJS DevTools VSCode extension](https://marketplace.visualstudio.com/items?itemName=forinda.kickjs-devtools) — install it, run **KickJS: Connect to App…** from the palette, and the Activity Bar gets Health / Routes / DI Container tree views without leaving the editor. Click a route (or its inline **Open Handler** button) to jump to the handler — the path comes from the app, and the extension maps it into your workspace when the app runs elsewhere (a container, another checkout). When the server requires a token, run **KickJS: Set DevTools Token…** to paste it.

## Security

- DevTools is **disabled by default in production** (`NODE_ENV === 'production'`)
- Config endpoint is **opt-in** and redacts all variables not matching your prefix list
- Consider adding authentication middleware if exposing in staging environments
- The browser dashboard's auth gate (above) is the front door for `requireToken: true` mounts; the token is sent as `x-devtools-token` header on every request
- With a `secret` set, only the dashboard page and its static bundle (`/_debug/assets/*`) load without the token; every `/_debug/*` data endpoint requires it
