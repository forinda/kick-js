# OpenTelemetry with KickJS

KickJS doesn't ship a first-party OTel package — the SDK has its own opinionated lifecycle (it registers `process.on('SIGTERM')` to flush spans before exit, owns its own context propagation, and pulls heavy dependencies). Instead, this guide shows how to mount **your own** OTel adapter that cooperates with KickJS's lifecycle and ALS-backed request store.

::: warning Two SIGTERM handlers race each other
The OpenTelemetry Node SDK installs `process.on('SIGTERM', ...)` to call `sdk.shutdown()` and flush in-flight spans. KickJS does the same to call `app.shutdown()`. Both then call `process.exit(0)`. Whichever returns first wins, the loser truncates.

Set `processHooks: 'errors-only'` on `bootstrap()` to let the OTel SDK own shutdown. KickJS keeps the `uncaughtException` / `unhandledRejection` loggers but skips the signal handlers; the SDK calls `app.shutdown()` itself as part of its own teardown sequence.
:::

## Setup

Install the upstream SDK and exporters you actually want:

```bash
pnpm add @opentelemetry/sdk-node \
         @opentelemetry/api \
         @opentelemetry/instrumentation-http \
         @opentelemetry/exporter-trace-otlp-http
```

## Adapter — own the OTel SDK lifecycle

```ts
// src/adapters/otel.adapter.ts
import { NodeSDK } from '@opentelemetry/sdk-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions'
import { defineAdapter, type AdapterContext } from '@forinda/kickjs'

export interface OtelAdapterOptions {
  serviceName: string
  serviceVersion?: string
  /** OTLP collector endpoint. Default: `http://localhost:4318/v1/traces`. */
  endpoint?: string
}

export const OtelAdapter = defineAdapter<OtelAdapterOptions>({
  name: 'OtelAdapter',
  build: (config) => {
    const sdk = new NodeSDK({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: config.serviceName,
        [ATTR_SERVICE_VERSION]: config.serviceVersion ?? '0.0.0',
      }),
      traceExporter: new OTLPTraceExporter({
        url: config.endpoint ?? 'http://localhost:4318/v1/traces',
      }),
      instrumentations: [new HttpInstrumentation()],
    })

    return {
      // Start the SDK BEFORE the framework loads modules so the
      // HTTP instrumentation hooks Express on require.
      async beforeStart(_ctx: AdapterContext) {
        await sdk.start()
      },

      // KickJS calls every adapter's shutdown via Promise.allSettled,
      // so the SDK flush happens cooperatively with whatever the rest
      // of the app needs to clean up.
      async shutdown() {
        await sdk.shutdown()
      },
    }
  },
})
```

## Bootstrap — opt out of the framework's signal handlers

```ts
// src/index.ts
import 'reflect-metadata'
import './config'
import { bootstrap } from '@forinda/kickjs'
import { modules } from './modules'
import { OtelAdapter } from './adapters/otel.adapter'

export const app = await bootstrap({
  modules,
  adapters: [
    OtelAdapter({ serviceName: 'my-api', serviceVersion: '1.0.0' }),
  ],
  // Critical: let the OTel SDK own SIGTERM. KickJS keeps the
  // uncaughtException / unhandledRejection loggers but skips
  // signal registration so the SDK's own handler can flush
  // spans without racing us to process.exit().
  processHooks: 'errors-only',
})
```

The OTel SDK's signal handler calls `sdk.shutdown()`, which inside completes via the SDK's own choreography. Because KickJS only emitted the error loggers, there's no second handler racing for `process.exit(0)`.

## Per-route attributes from a Context Contributor

Use the contributor pipeline to set OTel span attributes per request — typed via `ContextMeta`, available from any handler / service:

```ts
// src/contributors/trace.context.ts
import { trace } from '@opentelemetry/api'
import { defineHttpContextDecorator } from '@forinda/kickjs'

declare module '@forinda/kickjs' {
  interface ContextMeta {
    trace: { traceId: string; spanId: string }
  }
}

export const AttachTrace = defineHttpContextDecorator({
  key: 'trace',
  resolve: (_ctx) => {
    const span = trace.getActiveSpan()
    const sc = span?.spanContext()
    return {
      traceId: sc?.traceId ?? '',
      spanId: sc?.spanId ?? '',
    }
  },
})
```

Mount it globally:

```ts
bootstrap({
  modules,
  adapters: [OtelAdapter({ serviceName: 'my-api' })],
  contributors: [AttachTrace.registration],
  processHooks: 'errors-only',
})
```

Now any handler can `ctx.get('trace')` and any service can `getRequestValue('trace')` — the trace/span IDs land in your application logs, audit records, error reports, etc., without threading them through every method signature.

## Redacting sensitive attributes

The previous shipped adapter did this for you. Inline it as a tiny helper — keeps the contract narrow and visible:

```ts
// src/lib/redact.ts
const SENSITIVE = new Set(['authorization', 'cookie', 'set-cookie', 'x-api-key', 'password'])

export function redact<T extends Record<string, unknown>>(attrs: T): T {
  const out = { ...attrs }
  for (const key of Object.keys(out)) {
    if (SENSITIVE.has(key.toLowerCase())) {
      out[key] = '[REDACTED]' as unknown as T[Extract<keyof T, string>]
    }
  }
  return out
}
```

Call `redact()` before `span.setAttributes(...)` anywhere you add headers/body to a span.

## DevTools integration

Surface SDK state and recent span counts on the DevTools dashboard via the `introspect()` slot — no separate wiring needed:

```ts
import { defineAdapter } from '@forinda/kickjs'
import type { IntrospectionSnapshot } from '@forinda/kickjs-devtools-kit'

export const OtelAdapter = defineAdapter<OtelAdapterOptions>({
  name: 'OtelAdapter',
  build: (config) => {
    let spans = 0
    let exporterErrors = 0
    // (increment these from a SpanProcessor wrapper or exporter hook)

    return {
      // ... beforeStart / shutdown as above

      introspect(): IntrospectionSnapshot {
        return {
          protocolVersion: 1,
          name: 'OtelAdapter',
          kind: 'adapter',
          state: {
            serviceName: config.serviceName,
            endpoint: config.endpoint ?? 'http://localhost:4318/v1/traces',
          },
          metrics: { spansEmitted: spans, exporterErrors },
        }
      },
    }
  },
})
```

The DevTools topology tab will show OtelAdapter alongside other adapters with a live counter for `spansEmitted` / `exporterErrors`. Adopt `devtoolsTabs()` if you want a dedicated panel (e.g. a button to manually flush spans for debugging).

## What you give up by going BYO

The previous `@forinda/kickjs-otel` adapter pre-wired three things you'd otherwise inline:

1. **Auto-spans for each HTTP request** — replaced by `HttpInstrumentation()` in the SDK setup above.
2. **Per-route latency histograms** — add a manual `meter.createHistogram(...)` and record on `afterRoutes` middleware.
3. **`ignoreRoutes` array** — replace with `HttpInstrumentation`'s `ignoreIncomingRequestHook` option.

Everything else (exporters, propagators, samplers, instrumentations) was always pass-through to the upstream SDK — the wrapper added no value there.

## Related

- [Adapters](./adapters.md) — `defineAdapter` factory reference
- [Context Decorators](./context-decorators.md) — typed per-request values
- [Lifecycle](./lifecycle.md) — adapter hook order + `processHooks` semantics
- [OpenTelemetry Node SDK docs](https://opentelemetry.io/docs/languages/js/getting-started/nodejs/)
