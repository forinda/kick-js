# Observing Errors and Responses

Every error and every finished response goes through one place, so an error tracker, a metrics exporter or an APM agent hooks in **once** instead of replacing the error handler and patching each source.

There are two ways in:

- **`onError` / `onResponse` hooks** on any adapter or plugin — for integrations you write.
- **`diagnostics_channel` channels** — for APM agents and OpenTelemetry instrumentations that should work without being registered anywhere.

Both are observe-only: they can't change the response, and an observer that throws is logged and skipped, so it never breaks a request or another observer. Both run on the Node server (`bootstrap()` and `createHandler()`) on every runtime — Express, Fastify and h3.

## The hooks

```ts
import { defineAdapter } from '@forinda/kickjs'

export const ErrorReporter = defineAdapter({
  name: 'ErrorReporter',
  build: () => ({
    onError(error, info) {
      // Request errors arrive at any status — filter on it.
      if (info.source === 'request' && (info.status ?? 500) < 500) return
      tracker.capture(error, { tags: { source: info.source, route: info.route }, extra: info })
    },
    onResponse(info) {
      metrics.histogram('http_request_duration_ms', info.durationMs, {
        method: info.method,
        route: info.route ?? 'unmatched',
        status: String(info.status),
      })
    },
  }),
})
```

Plugins take the same two hooks.

### What `onError` receives

`info.source` says where the error came from:

| `source`              | When                                                                            |
| --------------------- | ------------------------------------------------------------------------------- |
| `request`             | A handler, middleware, guard or validation threw — any status, 4xx included     |
| `uncaught`            | An uncaught exception (with the default `processHooks`)                         |
| `unhandled-rejection` | An unhandled promise rejection                                                  |
| `background`          | Work passed to [`ctx.waitUntil()`](./serverless.md) failed                      |
| `cron`                | A [`@Cron`](./cron.md) job failed (`context` holds job, expression, trigger)    |
| `job`                 | A `@forinda/kickjs-queue` job failed (`context` holds queue, job, id, attempts) |

Request errors also carry `method`, `path`, `route` (the matched pattern, e.g. `/api/v1/users/:id`), `status` (what the error is answered with) and `requestId`.

Observers run **before** the error handler — the default one or your `bootstrap({ onError })` — which still answers the request as before.

### What `onResponse` receives

`{ method, path, route, status, durationMs, requestId }` for every finished response. `route` is the full matched pattern, or `undefined` when nothing matched (404s), so metrics grouped by route stay bounded. Responses are only timed while something listens.

### Reporting your own errors

A message consumer, or any code outside a request, can report through the same funnel:

```ts
import { reportError } from '@forinda/kickjs'

consumer.on('error', (err, msg) =>
  reportError(err, { source: 'consumer', context: { id: msg.id } }),
)
```

## The channels

| Channel           | Kind                                                                    | Payload                                                  |
| ----------------- | ----------------------------------------------------------------------- | -------------------------------------------------------- |
| `kickjs:handler`  | tracing channel (`start` / `end` / `asyncStart` / `asyncEnd` / `error`) | `{ method, route, controller, handler, requestId, ctx }` |
| `kickjs:error`    | channel                                                                 | `{ error, ...info }` — the same as `onError`             |
| `kickjs:response` | channel                                                                 | the same as `onResponse`                                 |

`kickjs:handler` wraps the controller method itself, so a span started on `start` covers the handler and follows its async work. The names are exported as `HANDLER_CHANNEL`, `ERROR_CHANNEL` and `RESPONSE_CHANNEL`. With no subscriber, nothing is published and nothing is timed.

```ts
import { tracingChannel } from 'node:diagnostics_channel'
import { trace } from '@opentelemetry/api'

const tracer = trace.getTracer('kickjs')
const spans = new WeakMap()

tracingChannel('kickjs:handler').subscribe({
  start(ctx) {
    spans.set(
      ctx,
      tracer.startSpan(`${ctx.method} ${ctx.route}`, { attributes: { 'http.route': ctx.route } }),
    )
  },
  asyncEnd(ctx) {
    spans.get(ctx)?.end()
  },
  error(ctx) {
    spans.get(ctx)?.recordException(ctx.error)
  },
})
```

## Not covered

- The web entry (`@forinda/kickjs/web` — Workers, Bun, Deno) has no adapters or plugins, and doesn't publish the channels.
- Adapters' own `middleware()` and context contributors aren't traced separately; they run inside the request, before the handler span.
