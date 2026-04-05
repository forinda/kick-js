# Middleware

KickJS provides middleware at three levels: global (applied to all requests), class-level (applied to all routes in a controller), and method-level (applied to a single route handler). Adapters can also inject middleware at specific phases of the pipeline.

## MiddlewareHandler Type

All KickJS middleware follows the same signature:

```ts
type MiddlewareHandler<TCtx = any> = (ctx: TCtx, next: () => void) => void | Promise<void>
```

The generic `TCtx` defaults to `any`. For full type safety, pass `RequestContext`:

```ts
import type { MiddlewareHandler } from '@forinda/kickjs'
import type { RequestContext } from '@forinda/kickjs'

const authMiddleware: MiddlewareHandler<RequestContext> = async (ctx, next) => {
  const token = ctx.headers['authorization']  // fully typed
  if (!token) return ctx.badRequest('Missing authorization header')

  ctx.set('user', { id: 'user-123' })
  next()
}
```

## @Middleware Decorator

The `@Middleware()` decorator works on both classes and methods. It accepts one or more handler functions.

### Class-level middleware

Runs on every route in the controller, before any method-level middleware:

```ts
import { Controller, Get, Middleware } from '@forinda/kickjs'

@Controller()
@Middleware(authMiddleware, loggingMiddleware)
export class SecureController {
  @Get('/')
  async list(ctx: RequestContext) {
    const user = ctx.get('user')
    ctx.json({ user })
  }
}
```

### Method-level middleware

Runs only on the decorated route, after class-level middleware:

```ts
@Controller()
export class TodoController {
  @Post('/')
  @Middleware(rateLimitMiddleware)
  async create(ctx: RequestContext) {
    ctx.created({ id: '1' })
  }

  @Get('/')   // no extra middleware
  async list(ctx: RequestContext) {
    ctx.json([])
  }
}
```

### Execution order

For a given route, middleware executes in this order:

1. Validation middleware (from route decorator `{ body, query, params }`)
2. Class-level `@Middleware()` handlers (in declaration order)
3. Method-level `@Middleware()` handlers (in declaration order)
4. The route handler

## Global Middleware

Global middleware is configured in `bootstrap()` via the `middleware` option. These run on every request before any route is matched.

::: warning Different signature from @Middleware
Global middleware uses the **raw Express signature** `(req, res, next)`, not the KickJS `MiddlewareHandler` signature `(ctx, next)`. This is because global middleware runs before routes are matched, outside the KickJS `RequestContext` pipeline.

| Location | Signature | Receives |
|---|---|---|
| `bootstrap({ middleware })` | `(req, res, next)` | Express `Request`, `Response`, `NextFunction` |
| `@Middleware()` on class/method | `(ctx, next)` | KickJS `RequestContext`, `next()` |
| Adapter `middleware()` | `(req, res, next)` | Express `Request`, `Response`, `NextFunction` |

Using the wrong signature causes runtime crashes. If you see `Cannot read properties of undefined`, check which signature you're using.
:::

```ts
import express from 'express'
import { bootstrap, requestId } from '@forinda/kickjs'
import { modules } from './modules'

bootstrap({
  modules,
  middleware: [
    requestId(),
    express.json({ limit: '1mb' }),
    helmet(),
    cors(),
    morgan('dev'),
  ],
})
```

If you omit the `middleware` option, sensible defaults are applied:

```ts
// Default pipeline when middleware is not specified:
requestId()
express.json({ limit: '100kb' })
```

Global middleware entries can be path-scoped:

```ts
middleware: [
  express.json(),
  { path: '/api/v1/webhooks', handler: express.raw({ type: '*/*' }) },
]
```

## Adapter Middleware Phases

Adapters (database, rate limiting, CORS, Swagger, etc.) can inject middleware at four phases in the pipeline. This is done by implementing the `middleware()` method on `AppAdapter`:

```ts
import type { AppAdapter, AdapterMiddleware } from '@forinda/kickjs'

class RateLimitAdapter implements AppAdapter {
  middleware(): AdapterMiddleware[] {
    return [
      {
        handler: rateLimit({ max: 200 }),
        phase: 'beforeRoutes',
      },
      {
        path: '/api/v1/auth',
        handler: rateLimit({ max: 10 }),
        phase: 'beforeRoutes',
      },
    ]
  }
}
```

### Phase order

The full middleware pipeline executes in this order:

| Step | Phase            | Source                |
| ---- | ---------------- | --------------------- |
| 1    | `beforeMount`    | Adapter hooks (early routes like health, docs UI) |
| 2    | `beforeGlobal`   | Adapter middleware    |
| 3    | global           | User-declared `middleware` array |
| 4    | `afterGlobal`    | Adapter middleware    |
| 5    | DI bootstrap     | Module `register()` calls |
| 6    | `beforeRoutes`   | Adapter middleware    |
| 7    | routes           | Module route mounting |
| 8    | `afterRoutes`    | Adapter middleware    |
| 9    | error handlers   | Built-in 404 + global error handler |

### AdapterMiddleware interface

```ts
interface AdapterMiddleware {
  handler: any             // Express-compatible (req, res, next) handler
  phase?: MiddlewarePhase  // 'beforeGlobal' | 'afterGlobal' | 'beforeRoutes' | 'afterRoutes'
  path?: string            // Optional path scope
}
```

If `phase` is omitted, it defaults to `'afterGlobal'`.

## Writing Reusable Middleware

A factory function pattern works well for configurable middleware:

```ts
export function requireRole(role: string): MiddlewareHandler {
  return (ctx: RequestContext, next) => {
    const user = ctx.get('user')
    if (user?.role !== role) {
      return ctx.json({ message: 'Forbidden' }, 403)
    }
    next()
  }
}
```

```ts
@Controller('/admin')
@Middleware(authMiddleware, requireRole('admin'))
export class AdminController { ... }
```

## Circuit Breaker

The `CircuitBreaker` class implements the [circuit breaker pattern](https://martinfowler.com/bliki/CircuitBreaker.html) for external service calls. It protects your application from cascading failures when a downstream service is unhealthy by short-circuiting requests after a configurable failure threshold.

### States

| State | Description |
|---|---|
| **CLOSED** | Normal operation. Requests pass through. Failures are counted. |
| **OPEN** | Failures exceeded the threshold. All requests are immediately rejected with `CircuitOpenError`. |
| **HALF_OPEN** | After `resetTimeout` elapses the circuit allows a limited number of probe requests. If they succeed the circuit closes; if any fail it re-opens. |

### Configuration options

| Option | Type | Default | Description |
|---|---|---|---|
| `failureThreshold` | `number` | *(required)* | Consecutive failures before the circuit opens. |
| `resetTimeout` | `number` | *(required)* | Milliseconds to wait in OPEN state before transitioning to HALF_OPEN. |
| `halfOpenMax` | `number` | `1` | Maximum probe requests allowed while HALF_OPEN. |

### Usage

```ts
import { CircuitBreaker, CircuitOpenError } from '@forinda/kickjs'

const breaker = new CircuitBreaker('payment-api', {
  failureThreshold: 5,
  resetTimeout: 30_000, // 30 seconds
  halfOpenMax: 2,
})

// Wrap any async call
try {
  const res = await breaker.execute(() =>
    fetch('https://payment.example.com/charge', {
      method: 'POST',
      body: JSON.stringify({ amount: 1999 }),
    }),
  )
  const data = await res.json()
} catch (err) {
  if (err instanceof CircuitOpenError) {
    // The circuit is open — fail fast without hitting the remote service
    console.warn(err.message)
  }
}
```

### Inspecting and resetting

```ts
breaker.getState()
// => 'closed' | 'open' | 'half_open'

breaker.getStats()
// => { failures: 3, successes: 12, state: 'closed', lastFailure?: Date }

// Manually reset to CLOSED (e.g. after deploying a fix upstream)
breaker.reset()
```

## Trace Context

The `traceContext()` middleware implements [W3C Trace Context](https://www.w3.org/TR/trace-context/) propagation. It parses an incoming `traceparent` header and, if none is present, generates a new trace ID so every request is always correlated.

### Setup

`traceContext()` must be mounted **after** `requestScopeMiddleware()` because it stores values in the request's `AsyncLocalStorage` store.

```ts
import express from 'express'
import { bootstrap, requestScopeMiddleware, traceContext, requestLogger } from '@forinda/kickjs'

bootstrap({
  modules,
  middleware: [
    requestScopeMiddleware(),
    traceContext(),        // extracts or generates traceId
    requestLogger(),       // logger automatically includes traceId
    express.json(),
  ],
})
```

### How it works

1. Reads the `traceparent` header (e.g. `00-4bf92f3577b6a27ff0753a3a97bb3345-00f067aa0ba902b7-01`).
2. If valid, extracts `traceId`, `parentSpanId`, `version`, and `flags`.
3. If missing or invalid, generates a random 32-hex trace ID and 16-hex span ID.
4. Stores `traceId`, `spanId`, `traceFlags`, and `traceVersion` in the request-scoped `AsyncLocalStorage` store, making them available to the built-in logger and any downstream code.
5. Also exposes `req.traceId` and `req.spanId` directly on the Express request object for convenience.

### Options

| Option              | Type      | Default | Description                                                                                                                               |
| ------------------- | --------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `propagateResponse` | `boolean` | `false` | When `true`, sets a `traceresponse` header on the outgoing response containing the trace ID. Useful for debugging client-side requests. |

```ts
traceContext({ propagateResponse: true })
// Response will include:  traceresponse: 4bf92f3577b6a27ff0753a3a97bb3345
```

### Accessing the trace ID in application code

Inside a controller or service you can read the trace values from the request store:

```ts
import { requestStore } from '@forinda/kickjs'

const store = requestStore.getStore()
const traceId = store?.values.get('traceId')
const spanId = store?.values.get('spanId')
```

Or directly from the request object:

```ts
@Get('/health')
async health(ctx: RequestContext) {
  const traceId = (ctx.req as any).traceId
  ctx.json({ status: 'ok', traceId })
}
```
