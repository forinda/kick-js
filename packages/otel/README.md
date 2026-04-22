# @forinda/kickjs-otel

OpenTelemetry adapter for KickJS — auto request spans + counter/histogram metrics, route ignore list, span-attribute redaction. Works with any OTel backend (Jaeger, Grafana Tempo, Datadog, Honeycomb, etc.).

## Install

```bash
kick add otel
```

## Quick Example

```ts
import { bootstrap } from '@forinda/kickjs'
import { OtelAdapter } from '@forinda/kickjs-otel'
import { modules } from './modules'

export const app = await bootstrap({
  modules,
  adapters: [
    OtelAdapter({
      serviceName: 'my-api',
      ignoreRoutes: ['/health', '/_debug/*'],
      sensitiveKeys: ['authorization', /^x-api-key/i],
    }),
  ],
})
```

For production, initialize the OTel SDK before `bootstrap()`:

```ts
import { NodeSDK } from '@opentelemetry/sdk-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'

new NodeSDK({
  traceExporter: new OTLPTraceExporter({ url: 'http://localhost:4318/v1/traces' }),
}).start()
```

## Documentation

[forinda.github.io/kick-js/api/otel](https://forinda.github.io/kick-js/api/otel)

## License

MIT
