# OpenTelemetry Example

Task CRUD API with automatic OpenTelemetry tracing. Every request creates a span logged to the console — no external backend needed.

## Features

- `OtelAdapter` with tracing and metrics
- CLI-generated task module (18 files, full DDD)
- Console span exporter for immediate visibility
- DevTools and Swagger included

## Running

```bash
cd examples/otel-api
kick dev
```

Then make requests and watch spans print to the console:

```bash
curl -X POST http://localhost:3000/api/v1/tasks \
  -H 'Content-Type: application/json' \
  -d '{"name": "Write tests"}'

curl http://localhost:3000/api/v1/tasks
```

## Tracing Setup

The `src/tracing.ts` file initializes the OTel SDK before the app starts:

```ts
import { NodeSDK } from '@opentelemetry/sdk-node'
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-base'

const sdk = new NodeSDK({
  traceExporter: new ConsoleSpanExporter(),
})
sdk.start()
```

To switch to Jaeger or Grafana Tempo, replace `ConsoleSpanExporter` with `OTLPTraceExporter`:

```ts
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({
    url: 'http://localhost:4318/v1/traces',
  }),
})
```

## Source

- [examples/otel-api/](https://github.com/forinda/kick-js/tree/main/examples/otel-api)
