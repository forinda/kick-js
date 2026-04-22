# DevTools API Example

This example demonstrates the **DevToolsAdapter** and **reactivity module** — Vue-inspired reactive state for backend observability.

## What It Shows

- `DevToolsAdapter` with all debug endpoints enabled
- Custom reactive state (peak concurrency tracking)
- `ref()`, `computed()`, `watch()` used outside the adapter
- Direct `subscribe()` on reactive values for milestones
- Config exposure with prefix-based redaction
- Custom error rate alert callback

## Quick Start

```bash
cd examples/devtools-api
pnpm install
kick dev
```

## Debug Endpoints

Once running, visit these endpoints:

| Endpoint | Description |
|----------|-------------|
| `GET /_debug/routes` | All registered routes with middleware |
| `GET /_debug/container` | DI container state |
| `GET /_debug/metrics` | Request counts, error rate, latency |
| `GET /_debug/health` | Health status (200 or 503) |
| `GET /_debug/state` | Full reactive state snapshot |
| `GET /_debug/config` | Sanitized environment variables |
| `GET /docs` | Swagger UI |

## Key Code

### Bootstrap with DevTools (`src/index.ts`)

```ts
import { DevToolsAdapter } from '@forinda/kickjs-devtools'
import { ref, computed, watch } from '@forinda/kickjs'

// Custom reactive state
const peakConcurrency = ref(0)
const activeConcurrency = ref(0)

watch(activeConcurrency, (current) => {
  if (current > peakConcurrency.value) {
    peakConcurrency.value = current
  }
})

// DevTools adapter with config
const devtools = DevToolsAdapter({
  enabled: true,
  exposeConfig: true,
  configPrefixes: ['APP_', 'NODE_ENV', 'PORT'],
  errorRateThreshold: 0.3,
  onErrorRateExceeded: (rate) => {
    log.warn(`Alert: error rate at ${(rate * 100).toFixed(1)}%`)
  },
})

// Subscribe to reactive values
devtools.requestCount.subscribe((count) => {
  if (count > 0 && count % 100 === 0) {
    log.info(`Milestone: ${count} requests served`)
  }
})

bootstrap({
  modules,
  adapters: [devtools, new SwaggerAdapter({ ... })],
})
```

## Project Structure

```
examples/devtools-api/
├── src/
│   ├── index.ts              # Bootstrap with DevToolsAdapter
│   └── modules/
│       └── products/         # DDD module (generated with kick g module)
│           ├── presentation/
│           ├── application/
│           ├── domain/
│           └── infrastructure/
├── kick.config.ts
├── vite.config.ts
└── package.json
```

## Related Docs

- [Reactivity Guide](../guide/reactivity.md)
- [DevTools Guide](../guide/devtools.md)
