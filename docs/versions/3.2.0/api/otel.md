# @forinda/kickjs-otel

OpenTelemetry adapter for KickJS — automatic HTTP tracing and request metrics.

## Installation

```bash
pnpm add @forinda/kickjs-otel @opentelemetry/api
# Plus your exporter:
pnpm add @opentelemetry/exporter-trace-otlp-http  # OTLP/Jaeger
pnpm add @opentelemetry/exporter-jaeger            # Jaeger direct
```

## Quick Start

```ts
import { OtelAdapter } from '@forinda/kickjs-otel'

bootstrap({
  modules,
  adapters: [
    new OtelAdapter({
      serviceName: 'my-api',
      serviceVersion: '1.0.0',
      ignoreRoutes: ['/health', '/_debug/*'],
    }),
  ],
})
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `serviceName` | `string` | `'kickjs-app'` | Service name in traces/metrics |
| `serviceVersion` | `string` | `'0.0.0'` | Service version |
| `tracing` | `boolean` | `true` | Enable request span creation |
| `metrics` | `boolean` | `true` | Enable request counter and histogram |
| `ignoreRoutes` | `string[]` | `[]` | Paths to skip (exact or prefix with `*`) |
| `customAttributes` | `(req) => Record` | — | Extra span attributes per request |
| `sensitiveKeys` | `(string \| RegExp)[]` | — | Span-attribute keys to mask before export |
| `redactAttribute` | `(key, value) => unknown` | — | Custom redactor — takes precedence over `sensitiveKeys` |

## Redacting Sensitive Attributes

`sensitiveKeys` mirrors pino's `redact.paths` so the same list can drive both log and span redaction:

```ts
// src/config/redaction.ts
export const sensitiveKeys = ['password', 'token', 'authorization', /^x-api-key/i]

// src/logger.ts
pino({ redact: { paths: sensitiveKeys } })

// src/index.ts
new OtelAdapter({ sensitiveKeys })
```

String entries match the attribute key case-insensitively; `RegExp` entries match verbatim. Matching attributes export as `'[REDACTED]'`. For value-aware redaction (e.g. look inside strings for card numbers), use `redactAttribute`:

```ts
new OtelAdapter({
  redactAttribute: (key, value) =>
    typeof value === 'string' && /\d{16}/.test(value) ? '[REDACTED]' : value,
})
```

`adapter.applyRedaction(attrs)` is exposed so downstream code that calls `span.setAttributes(...)` directly can apply the same mask.

## Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `http.server.request.count` | Counter | Total requests by method/route/status |
| `http.server.request.duration` | Histogram | Request duration in ms |

## Span Attributes

Each request span includes:
- `http.method` — GET, POST, etc.
- `http.url` — Full request URL
- `http.target` — Request path
- `http.route` — Matched route pattern
- `http.status_code` — Response status
- `http.user_agent` — Client user agent

## Related

- [DevTools Adapter](../guide/devtools.md) — built-in reactive metrics without OTel
- [Reactivity](../guide/reactivity.md) — reactive state system powering DevTools
