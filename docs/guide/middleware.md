# Middleware

KickJS provides middleware at three levels: global (applied to all requests), class-level (applied to all routes in a controller), and method-level (applied to a single route handler). Adapters can also inject middleware at specific phases of the pipeline.

## MiddlewareHandler Type

All KickJS middleware follows the same signature:

```ts
type MiddlewareHandler = (ctx: any, next: () => void) => void | Promise<void>
```

The `ctx` parameter is a `RequestContext` instance. Call `next()` to pass control to the next handler in the chain.

```ts
import type { MiddlewareHandler } from '@forinda/kickjs-core'
import type { RequestContext } from '@forinda/kickjs-http'

const authMiddleware: MiddlewareHandler = async (ctx: RequestContext, next) => {
  const token = ctx.headers['authorization']
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
import { Controller, Get, Middleware } from '@forinda/kickjs-core'

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
import { bootstrap, requestId } from '@forinda/kickjs-http'
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
import type { AppAdapter, AdapterMiddleware } from '@forinda/kickjs-core'

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
