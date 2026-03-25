# @forinda/kickjs-devtools

Development introspection dashboard for KickJS — routes, DI container, metrics, and health.

## Install

```bash
# Using the KickJS CLI (recommended — installs as dev dependency)
kick add devtools

# Manual install
pnpm add -D @forinda/kickjs-devtools
```

## Features

- `DevToolsAdapter` — lifecycle adapter that mounts debug endpoints
- Route inspection, DI container state, request metrics, health checks
- Config exposure with prefix-based redaction
- Error rate threshold alerts
- Reactive state snapshot via `/_debug/state`

## Debug Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /_debug/routes` | All registered routes with middleware |
| `GET /_debug/container` | DI container state |
| `GET /_debug/metrics` | Request counts, error rate, latency |
| `GET /_debug/health` | Health status (200 or 503) |
| `GET /_debug/state` | Full reactive state snapshot |
| `GET /_debug/config` | Sanitized environment variables |

## Quick Example

```typescript
import { DevToolsAdapter } from '@forinda/kickjs-devtools'

bootstrap({
  modules,
  adapters: [
    new DevToolsAdapter({
      enabled: true,
      exposeConfig: true,
      configPrefixes: ['APP_', 'NODE_ENV', 'PORT'],
      errorRateThreshold: 0.3,
      onErrorRateExceeded: (rate) => {
        console.warn(`Error rate: ${(rate * 100).toFixed(1)}%`)
      },
    }),
  ],
})
```

## Documentation

[Full documentation](https://forinda.github.io/kick-js/guide/devtools)

## License

MIT
