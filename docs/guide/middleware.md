# Middleware

KickJS provides middleware at three levels: global (applied to all requests), class-level (applied to all routes in a controller), and method-level (applied to a single route handler). Adapters can also inject middleware at specific phases of the pipeline.

::: tip Scaffold one
`kick g middleware <name>` writes a typed middleware function, and `-m` drops it inside a module folder rather than the shared directory.

<PmCommand exec="kick g middleware request-timer" />

For the short-circuiting kind, see [Guards](#guards) below. Full flag list: [Generators](./generators.md#kick-g-middleware).
:::

## MiddlewareHandler Type

All KickJS middleware follows the same signature:

```ts
type MiddlewareHandler<TCtx = any> = (ctx: TCtx, next: () => void) => unknown
```

The return value is ignored: a guard stops the request by writing a response and not calling `next()`, so `return ctx.problem.unauthorized()` works the same as calling it and then `return`. The generic `TCtx` defaults to `any`. For full type safety, pass `RequestContext`:

```ts
import type { MiddlewareHandler } from '@forinda/kickjs'
import type { RequestContext } from '@forinda/kickjs'

const authMiddleware: MiddlewareHandler<RequestContext> = async (ctx, next) => {
  const token = ctx.headers['authorization'] // fully typed
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

  @Get('/') // no extra middleware
  async list(ctx: RequestContext) {
    ctx.json([])
  }
}
```

### Execution order

For a given route, middleware executes in this order:

0. Contributors marked [`beforeValidation`](./context-decorators.md#running-before-validation-beforevalidation) — opt-in, for authentication
1. Validation middleware (from route decorator `{ body, query, params }`)
2. File-upload middleware (from `@FileUpload`)
3. Class-level `@Middleware()` handlers (in declaration order)
4. Method-level `@Middleware()` handlers (in declaration order)
5. **Context Contributor pipeline** ([context decorators](./context-decorators.md)) — runs after middleware, before the handler. Class + method + module + adapter + global contributors merge into one pipeline, topo-sorted by `dependsOn`.
6. The route handler

Steps 1-4 use the `@Middleware()` mechanism described above. Step 5 is the typed `defineContextDecorator()` primitive — use it when the only job of a middleware is to compute a value and stash it on `ctx`. Step 0 is the same pipeline, moved ahead for the contributors that ask for it — which is also what lets a guard in step 3-4 read the authenticated user.

## Guards

A guard is middleware whose job is to **stop the request** — auth, IP allow-lists, feature flags. Same `(ctx, next)` signature; the difference is that it answers instead of calling `next()`.

<PmCommand exec="kick g guard admin" />

The scaffold answers through `ctx.problem.*` rather than `ctx.res`:

```ts
export async function adminGuard(ctx: RequestContext, next: () => void): Promise<void> {
  const header = ctx.headers.authorization
  if (!header) {
    // `ctx.res` is the ENGINE-NATIVE response — `ctx.res.status(401).json(...)`
    // only works on Express. A FastifyReply has no `.json()`, h3's event has no
    // `.status()`. The `ctx.*` helpers work on every runtime.
    ctx.problem.unauthorized({ detail: 'Missing or invalid authorization header' })
    return
  }
  next()
}
```

Mount it with `@Middleware()` at class or method level:

```ts
@Controller()
@Middleware(adminGuard)
export class AdminController { ... }
```

`-m, --module <module>` puts it in a module folder instead of the shared directory.

**Reach for a contributor instead when the job is to produce a value** rather than to reject — see below.

### Exempting routes with flags

A guard that has to let some routes through should read a [route flag](./route-flags.md), not a list of pathnames. `ctx.route` is available to any `@Middleware()`, because it runs inside the matched route:

```ts
export async function adminGuard(ctx: RequestContext, next: () => void): Promise<void> {
  if (ctx.route?.flags.has('auth.public')) return next()
  if (!ctx.headers.authorization) {
    ctx.problem.unauthorized({ detail: 'Missing or invalid authorization header' })
    return
  }
  next()
}
```

`ctx.route` also carries `method`, `path`, `controller` and `handlerName`. The built-in `csrfGuard()` and `rateLimitGuard()` take an `exemptWhen` option that accepts the same flag tests — a name, `'!name'`, a single-polarity list, or a predicate.

## Middleware vs context decorators

KickJS has two ways to "do something before the handler runs". Picking the right one matters for type safety, ordering, and reusability.

| Concern                                     | `@Middleware()`                | `defineContextDecorator()`                    |
| ------------------------------------------- | ------------------------------ | --------------------------------------------- |
| Compute a typed value to stash on `ctx`     | Possible, untyped              | Built for this; types via `ContextMeta`       |
| Short-circuit the response                  | Yes (`return ctx.notFound()`)  | Not the right tool                            |
| Mutate the response stream                  | Yes (compression, etc.)        | No                                            |
| Run before route matching                   | Yes (global middleware)        | No (per-route only)                           |
| Read `ctx.route.flags`                      | Yes — unless mounted globally  | Yes, plus `skipWhen` / `onlyWhen`             |
| Declare ordering against another middleware | Manual array position          | `dependsOn: ['otherKey']` enforced at startup |
| Reusable across plugins/adapters            | Pass closures around           | Built-in `contributors?()` hook               |
| Errors abort boot if misconfigured          | No (silent until requests hit) | Yes (cycles/missing deps fail `app.setup()`)  |

Rule of thumb: **if the middleware's only job is to compute a value other code reads off `ctx`, use a context decorator.** For everything else, use `@Middleware()`. See [Context Decorators](./context-decorators.md) for the full guide.

## Global Middleware

Global middleware is configured in `bootstrap()` via the `middlewares` option. These run on every request before any route is matched.

::: tip Renamed from `middleware`
The option is `middlewares` (plural). The singular `middleware` still works as a **deprecated alias** — existing apps keep running — but new code should use `middlewares`. If you set both, `middlewares` wins.
:::

::: warning Different signature from @Middleware
Global middleware uses the **raw Express signature** `(req, res, next)`, not the KickJS `MiddlewareHandler` signature `(ctx, next)`. This is because global middleware runs before routes are matched, outside the KickJS `RequestContext` pipeline.

| Location                        | Signature          | Receives                                      |
| ------------------------------- | ------------------ | --------------------------------------------- |
| `bootstrap({ middlewares })`    | `(req, res, next)` | Express `Request`, `Response`, `NextFunction` |
| `@Middleware()` on class/method | `(ctx, next)`      | KickJS `RequestContext`, `next()`             |
| Adapter `middleware()`          | `(req, res, next)` | Express `Request`, `Response`, `NextFunction` |

Using the wrong signature causes runtime crashes. If you see `Cannot read properties of undefined`, check which signature you're using.
:::

```ts
import express from 'express'
import { bootstrap, requestId } from '@forinda/kickjs'
import { modules } from './modules'

bootstrap({
  modules,
  middlewares: [requestId(), express.json({ limit: '1mb' }), helmet(), cors(), morgan('dev')],
})
```

If you omit the `middlewares` option, sensible defaults are applied:

```ts
// Default pipeline when middlewares is not specified:
requestId()
express.json({ limit: '100kb' })
```

Global middleware entries can be path-scoped:

```ts
middlewares: [express.json(), { path: '/api/v1/webhooks', handler: express.raw({ type: '*/*' }) }]
```

## Compression

Compress responses with the standard [`compression`](https://www.npmjs.com/package/compression) middleware. It works the same on Express, Fastify and h3:

```ts
import compression from 'compression'

bootstrap({
  modules,
  middlewares: [compression() /* … your other middleware */],
})
```

Responses under 1 KB are left alone, and `Vary: Accept-Encoding` is set for caches. Server-sent events are never compressed: `ctx.sse()` sends `Cache-Control: no-transform`, so events reach the client as they are sent instead of waiting in a gzip buffer.

### Compressed static files

`compression()` covers your routes, not the files `SpaAdapter`, the Inertia adapter or `ctx.http.serveStatic()` serve. Those are served compressed when a `.br` or `.gz` copy sits beside the file — `app.js.br` next to `app.js` — and the browser accepts that encoding: Brotli first, then gzip, with `Vary: Accept-Encoding` and the original file's `Content-Type`. A range request gets the file as stored.

Write the copies when you build the client, with the Vite plugin from `@forinda/kickjs-vite`:

```ts
// vite.config.ts of the client
import { compressAssets } from '@forinda/kickjs-vite/compress'

export default defineConfig({
  plugins: [react(), compressAssets()],
})
```

It compresses HTML, CSS, JavaScript, JSON, source maps, SVG, text, XML and WebAssembly files of 1 KB or more, keeps a copy only when it is smaller, and skips SSR builds. `compressAssets({ threshold, encodings: ['br'] })` changes the size floor and the encodings. Projects from `kick new --template fullstack` and `--template inertia` have it already.

### BREACH padding (opt-in)

Compression can leak a secret: when a response holds both a secret (a token rendered into the page) and text an attacker controls (an echoed search term), how well the response compresses reveals whether the attacker's guess matches the secret — and TLS hides the bytes, not their count. This is the BREACH attack. Mitigate it by making every compressed response's size vary at random:

```ts
import compression from 'compression'
import { breachPadding } from '@forinda/kickjs'

bootstrap({
  modules,
  middlewares: [breachPadding(), compression() /* , … */], // breachPadding first
})
```

Each gzip response gets 0–99 random bytes in its header's file-name field, which decompressors ignore, so the compressed length no longer gives away the content (the BREACH attack). `breachPadding({ maxBytes })` changes the range.

The trade-off: the padding lives in the gzip header, which Brotli lacks, so `breachPadding()` removes `br` and `zstd` from the request's `Accept-Encoding` and browsers get gzip instead. Use it when your responses mix secrets with reflected input; most JSON APIs that keep tokens in cookies and headers don't need it.

On Netlify, Vercel and Cloudflare the platform compresses responses at the edge — leave the middleware out of `src/serverless.ts` deployments and the web entry.

## Adapter Middleware Phases

Adapters (database, rate limiting, CORS, Swagger, etc.) can inject middleware at four phases in the pipeline by returning a `middleware()` array from `defineAdapter()`'s `build`:

```ts
import { defineAdapter, type AdapterMiddleware } from '@forinda/kickjs'

const RateLimitAdapter = defineAdapter({
  name: 'RateLimitAdapter',
  build: () => ({
    middleware(): AdapterMiddleware[] {
      return [
        { handler: rateLimit({ max: 200 }), phase: 'beforeRoutes' },
        { path: '/api/v1/auth', handler: rateLimit({ max: 10 }), phase: 'beforeRoutes' },
      ]
    },
  }),
})
```

### Phase order

The full middleware pipeline executes in this order:

| Step | Phase          | Source                                                                                                                               |
| ---- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | `beforeMount`  | Adapter hooks (early routes like health, docs UI)                                                                                    |
| 2    | `beforeGlobal` | Adapter middleware                                                                                                                   |
| 3    | global         | User-declared `middleware` array                                                                                                     |
| 4    | `afterGlobal`  | Adapter middleware                                                                                                                   |
| 5    | DI bootstrap   | Module `register()` calls                                                                                                            |
| 6    | `beforeRoutes` | Adapter middleware                                                                                                                   |
| 7    | routes         | Module route mounting (per-route: validation → upload → `@Middleware()` → [contributor pipeline](./context-decorators.md) → handler) |
| 8    | `afterRoutes`  | Adapter middleware                                                                                                                   |
| 9    | error handlers | `onNotFound` + `onError` (or built-in defaults)                                                                                      |

### AdapterMiddleware interface

```ts
interface AdapterMiddleware {
  handler: any // Express-compatible (req, res, next) handler
  phase?: MiddlewarePhase // 'beforeGlobal' | 'afterGlobal' | 'beforeRoutes' | 'afterRoutes'
  path?: string // Optional path scope
}
```

If `phase` is omitted, it defaults to `'afterGlobal'`.

## Custom Error Handlers

By default, KickJS returns `{ message: 'Not Found' }` for unmatched routes and formats `ZodError`, `HttpException`, and unexpected errors. You can override both handlers:

### Custom 404 handler

```ts
bootstrap({
  modules,
  onNotFound: (req, res) => {
    res.status(404).json({
      error: 'Route not found',
      path: req.url, // not `originalUrl` — Express-only
      timestamp: new Date().toISOString(),
    })
  },
})
```

### Custom error handler

```ts
bootstrap({
  modules,
  onError: (err, req, res) => {
    const status = err.status ?? 500
    // `req.url`, not `req.originalUrl` — the latter is Express-only.
    logger.error({ err, method: req.method, url: req.url })
    res.status(status).json({
      error: err.message,
      code: err.code ?? 'INTERNAL_ERROR',
    })
  },
})
```

Both are connect-**shaped** — `onNotFound` receives `(req, res, next)` and
`onError` receives `(err, req, res, next)` — but they are not Express-
**semantic** on every engine. What arrives differs:

|         | `req`            | `res`             | `next`      |
| ------- | ---------------- | ----------------- | ----------- |
| Express | native `Request` | native `Response` | real `next` |
| Fastify | `request.raw`    | reply driver      | **no-op**   |
| h3      | `event.node.req` | response driver   | no-op       |

Two consequences to write for:

- **`next(err)` does nothing on Fastify and h3.** It is an inert function
  there, so delegating to the default handler silently drops the error. Send a
  response yourself instead.
- **Express-only request members are `undefined` elsewhere.**
  `req.originalUrl`, `req.path`, and `req.ip` are absent on the raw node
  request — use `req.url`, or `ctx.ip` where a `RequestContext` is in scope.

`res` is a `RuntimeResponse` on every engine, so `status`, `json`,
`send`, `setHeader`, `render`, `writeHead`, and `end` are all available.
When omitted, the built-in handlers are used.

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
@Controller()
@Middleware(authMiddleware, requireRole('admin'))
export class AdminController { ... }
```

## Circuit Breaker

The `CircuitBreaker` class implements the [circuit breaker pattern](https://martinfowler.com/bliki/CircuitBreaker.html) for external service calls. It protects your application from cascading failures when a downstream service is unhealthy by short-circuiting requests after a configurable failure threshold.

### States

| State         | Description                                                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **CLOSED**    | Normal operation. Requests pass through. Failures are counted.                                                                                   |
| **OPEN**      | Failures exceeded the threshold. All requests are immediately rejected with `CircuitOpenError`.                                                  |
| **HALF_OPEN** | After `resetTimeout` elapses the circuit allows a limited number of probe requests. If they succeed the circuit closes; if any fail it re-opens. |

### Configuration options

| Option             | Type     | Default      | Description                                                           |
| ------------------ | -------- | ------------ | --------------------------------------------------------------------- |
| `failureThreshold` | `number` | _(required)_ | Consecutive failures before the circuit opens.                        |
| `resetTimeout`     | `number` | _(required)_ | Milliseconds to wait in OPEN state before transitioning to HALF_OPEN. |
| `halfOpenMax`      | `number` | `1`          | Maximum probe requests allowed while HALF_OPEN.                       |

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

`traceContext()` writes into the request's `AsyncLocalStorage` frame, so
it has to run inside one. **By default** (`contextStore: 'auto'`),
KickJS opens that frame automatically before any user middleware, so
dropping `traceContext()` into your list just works:

```ts
import express from 'express'
import { bootstrap, traceContext, requestLogger } from '@forinda/kickjs'

bootstrap({
  modules,
  middlewares: [
    traceContext(), // extracts or generates traceId
    requestLogger(), // logger automatically includes traceId
    express.json(),
  ],
})
```

If you need to control the frame's position explicitly — e.g., to keep
an outer wrapper above it — mount `requestScopeMiddleware()` yourself
and place `traceContext()` after it. KickJS detects the explicit mount
and skips its default placement.

If you opted out of auto-mount with `contextStore: 'manual'`,
`traceContext()` will silently no-op (there's no frame to write
into) — make sure `requestScopeMiddleware()` (or your own ALS wrapper)
runs before it.

### How it works

1. Reads the `traceparent` header (e.g. `00-4bf92f3577b6a27ff0753a3a97bb3345-00f067aa0ba902b7-01`).
2. If valid, extracts `traceId`, `parentSpanId`, `version`, and `flags`.
3. If missing or invalid, generates a random 32-hex trace ID and 16-hex span ID.
4. Stores `traceId`, `spanId`, `traceFlags`, and `traceVersion` in the request-scoped `AsyncLocalStorage` store, making them available to the built-in logger and any downstream code.
5. Also exposes `req.traceId` and `req.spanId` directly on the Express request object for convenience.

### Options

| Option              | Type      | Default | Description                                                                                                                             |
| ------------------- | --------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `propagateResponse` | `boolean` | `false` | When `true`, sets a `traceresponse` header on the outgoing response containing the trace ID. Useful for debugging client-side requests. |

```ts
traceContext({ propagateResponse: true })
// Response will include:  traceresponse: 4bf92f3577b6a27ff0753a3a97bb3345
```

### Accessing the trace ID in application code

Inside a controller or service, read the trace values via the typed
helper. `getRequestValue` is keyed off the augmentable `ContextMeta`
registry — augment it once for the trace fields and every read returns
the right type:

```ts
declare module '@forinda/kickjs' {
  interface ContextMeta {
    traceId: string
    spanId: string
    parentSpanId: string
    traceFlags: number
    traceVersion: string
  }
}
```

```ts
import { getRequestValue } from '@forinda/kickjs'

const traceId = getRequestValue('traceId') // string | undefined
const spanId = getRequestValue('spanId') // string | undefined
```

Without the augmentation, the return type falls back to
`unknown | undefined`. Don't reach for a value-type generic
(`getRequestValue<string>('traceId')`) — that generic slot is the
**key** type, not the value type, and passing `<string>` widens the
key and hides the typed lookup.

`getRequestValue()` returns `undefined` outside a request frame —
null-tolerant by design so the same code can run in both request and
background paths.

Or directly from the request object inside a handler:

```ts
@Get('/health')
async health(ctx: RequestContext) {
  const traceId = (ctx.req as Request & { traceId?: string }).traceId
  ctx.json({ status: 'ok', traceId })
}
```
