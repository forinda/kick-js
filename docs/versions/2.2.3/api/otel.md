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
