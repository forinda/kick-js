# @forinda/kickjs-otel

OpenTelemetry adapter for KickJS — automatic tracing, metrics, and export to any OTel backend.

## Install

```bash
# Using the KickJS CLI (recommended — auto-installs peer dependencies)
kick add otel

# Manual install
pnpm add @forinda/kickjs-otel @opentelemetry/api @opentelemetry/semantic-conventions
# Optional SDK packages
pnpm add @opentelemetry/sdk-node @opentelemetry/sdk-trace-base @opentelemetry/sdk-metrics
```

## Features

- `OtelAdapter` — lifecycle adapter that instruments requests with spans and metrics
- Works with any OpenTelemetry-compatible backend (Jaeger, Grafana Tempo, Datadog, etc.)
- Zero-config console exporter for development

## Quick Example

```typescript
import { OtelAdapter } from '@forinda/kickjs-otel'

bootstrap({
  modules,
  adapters: [
    OtelAdapter({
      serviceName: 'my-api',
      enabled: true,
    }),
  ],
})
```

For production, initialize the OTel SDK before bootstrap:

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({
    url: 'http://localhost:4318/v1/traces',
  }),
})
sdk.start()
```

## Documentation

[Full documentation](https://forinda.github.io/kick-js/)

## License

MIT
