# @forinda/kickjs-otel

> [!WARNING] Deprecated — going private in v4.1.2.
> This package is being retired. The replacement is a short BYO recipe using `defineAdapter` / `definePlugin` from `@forinda/kickjs` directly — see **[guide/otel](https://forinda.github.io/kick-js/guide/otel)** for the copy-paste alternative.
>
> The package still works in v4.1.x; v4.1.2 will remove it from the public registry. Migrate at your convenience.

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
