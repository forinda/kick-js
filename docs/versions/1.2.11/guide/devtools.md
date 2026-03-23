# DevTools Adapter

The DevTools adapter provides Vue-style reactive introspection for KickJS applications. It exposes debug endpoints that let you inspect routes, DI container state, request metrics, and application health — all powered by the [reactivity module](./reactivity.md).

## Quick Start

```ts
import { bootstrap } from '@forinda/kickjs-http'
import { DevToolsAdapter } from '@forinda/kickjs-devtools'

bootstrap({
  modules: [UserModule, ProductModule],
  adapters: [
    new DevToolsAdapter({
      enabled: process.env.NODE_ENV !== 'production',
    }),
  ],
})
```

DevTools endpoints are now available at `/_debug/*`.

## Endpoints

### `GET /_debug/routes`

Lists all registered routes with their HTTP method, path, controller, handler, and middleware.

```json
{
  "routes": [
    {
      "method": "GET",
      "path": "/api/v1/users",
      "controller": "UserController",
      "handler": "getAll",
      "middleware": ["authGuard"]
    },
    {
      "method": "POST",
      "path": "/api/v1/users",
      "controller": "UserController",
      "handler": "create",
      "middleware": ["authGuard", "validate"]
    }
  ]
}
```

### `GET /_debug/container`

Shows all DI container registrations with their scope and instantiation status.

```json
{
  "registrations": [
    { "token": "UserService", "scope": "singleton", "instantiated": true },
    { "token": "ProductService", "scope": "singleton", "instantiated": false }
  ],
  "count": 2
}
```

### `GET /_debug/metrics`

Live request metrics powered by reactive refs and computed values.

```json
{
  "requests": 1542,
  "serverErrors": 3,
  "clientErrors": 28,
  "errorRate": 0.0019,
  "uptimeSeconds": 3600,
  "startedAt": "2026-03-20T10:00:00.000Z",
  "routeLatency": {
    "GET /api/v1/users": {
      "count": 500,
      "totalMs": 2500,
      "minMs": 2,
      "maxMs": 45
    }
  }
}
```

### `GET /_debug/health`

Deep health check with computed status derived from reactive error rate.

```json
{
  "status": "healthy",
  "errorRate": 0.0019,
  "uptime": 3600,
  "adapters": {
    "DevToolsAdapter": "running"
  }
}
```

Returns `200` when healthy, `503` when degraded (error rate exceeds threshold).

### `GET /_debug/ws`

WebSocket stats when `WsAdapter` is active. Shows namespaces, connections, message counts, and rooms.

```json
{
  "enabled": true,
  "totalConnections": 42,
  "activeConnections": 12,
  "messagesReceived": 1580,
  "messagesSent": 3200,
  "errors": 0,
  "namespaces": {
    "/ws/chat": { "connections": 8, "handlers": 10 },
    "/ws/notifications": { "connections": 4, "handlers": 4 }
  },
  "rooms": {
    "/ws/chat": ["room:general", "room:support"]
  }
}
```

Returns `404` if no `WsAdapter` is registered.

### `GET /_debug/state`

Full reactive state snapshot — everything in one endpoint.

```json
{
  "reactive": {
    "requestCount": 1542,
    "errorCount": 3,
    "clientErrorCount": 28,
    "errorRate": 0.0019,
    "uptimeSeconds": 3600,
    "startedAt": "2026-03-20T10:00:00.000Z"
  },
  "routes": 12,
  "container": 8,
  "routeLatency": {}
}
```

### `GET /_debug/config` (opt-in)

Sanitized environment variables. Only variables matching configured prefixes are shown; everything else is `[REDACTED]`.

```json
{
  "config": {
    "APP_NAME": "my-api",
    "APP_PORT": "3000",
    "NODE_ENV": "development",
    "DATABASE_URL": "[REDACTED]",
    "JWT_SECRET": "[REDACTED]"
  }
}
```

## Configuration

```ts
new DevToolsAdapter({
  // Base path for debug endpoints (default: '/_debug')
  basePath: '/_debug',

  // Only enable when true (default: process.env.NODE_ENV !== 'production')
  enabled: process.env.NODE_ENV !== 'production',

  // Expose sanitized env vars at /_debug/config (default: false)
  exposeConfig: true,

  // Env var prefixes to expose (default: ['APP_', 'NODE_ENV'])
  configPrefixes: ['APP_', 'DATABASE_', 'NODE_ENV'],

  // Error rate threshold for health degradation (default: 0.5)
  errorRateThreshold: 0.5,

  // Custom callback when error rate exceeds threshold
  onErrorRateExceeded: (rate) => {
    slackWebhook.send(`Error rate: ${(rate * 100).toFixed(1)}%`)
  },
})
```

## Accessing Reactive State Programmatically

The adapter exposes its reactive state as public properties, so you can compose with it:

```ts
const devtools = new DevToolsAdapter()

// Read reactive values
console.log(devtools.requestCount.value)
console.log(devtools.errorRate.value)

// Watch for changes
import { watch } from '@forinda/kickjs-core'

watch(devtools.errorRate, (rate) => {
  if (rate > 0.1) pagerDuty.alert('High error rate')
})

// Subscribe directly
devtools.requestCount.subscribe((newCount) => {
  prometheus.gauge('http_requests_total').set(newCount)
})
```

## How It Works

The DevToolsAdapter uses three layers:

1. **Reactive primitives** (`ref`, `computed`, `watch`) from `@forinda/kickjs-core/reactivity`
2. **Middleware** that increments reactive counters on each request (phase: `beforeGlobal`)
3. **Express routes** at `/_debug/*` that read reactive state and return JSON

Because the state is reactive, the computed values (error rate, uptime) are always consistent and only recalculate when their dependencies change.

## Security

- DevTools is **disabled by default in production** (`NODE_ENV === 'production'`)
- Config endpoint is **opt-in** and redacts all variables not matching your prefix list
- Consider adding authentication middleware if exposing in staging environments
