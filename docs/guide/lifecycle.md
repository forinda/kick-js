# Request Lifecycle

KickJS processes every request through a deterministic pipeline of middleware phases, adapter hooks, contributor resolution, and handler execution. Understanding this flow tells you exactly where your code runs and in what order — and where to plug in to extend it.

## Bootstrap Sequence

When `bootstrap()` is called, the application is assembled in this order:

```
 1. Adapter beforeMount hooks            (mount early routes that bypass middleware)
 2. Hardened defaults                    (disable x-powered-by, trust proxy)
 3. Request tracking + health endpoints
 4. Request scope (AsyncLocalStorage)    (requestScopeMiddleware)
 5. Adapter middleware: beforeGlobal     (e.g. tracing / scope-resolving adapters)
 6. Plugin registration + middleware
 7. Security defaults (auto-helmet)
 8. User middleware (cors, json, session, etc.)
 9. Adapter middleware: afterGlobal
10. Module registration + DI bootstrap
11. Adapter middleware: beforeRoutes     (e.g. AuthAdapter, rate limit)
12. Mount module routes                  (onRouteMount notifies adapters per controller)
13. Adapter middleware: afterRoutes
14. Error handlers (404 + global)
15. Adapter beforeStart hooks            (final DI registrations, log banner)
16. HTTP server listen                   (then afterStart hooks fire)
```

Steps 5 and 11 are where most adapter logic runs. Adapters that resolve cross-cutting per-request state (locale, tenant/workspace scope, geo, feature flags) typically run at `beforeGlobal`; auth / RBAC / rate limit run at `beforeRoutes` so they only protect matched routes.

## Request Flow

Every incoming request flows through this pipeline:

```
Request In
  │
  ├─ Request tracking (in-flight counter)
  ├─ Health check? (/health, /ready) → 200 OK (short-circuit)
  ├─ AsyncLocalStorage scope opened
  │
  ├─ ▸ beforeGlobal adapters
  │   └─ Example: a tracing adapter writes `requestStartedAt` into the request bag
  │
  ├─ Plugin middleware
  ├─ Security headers (helmet)
  ├─ User middleware (cors, json, session, etc.)
  ├─ ▸ afterGlobal adapters
  │
  ├─ ▸ beforeRoutes adapters
  │   └─ Example: AuthAdapter
  │       ├─ Resolve controller + method from URL
  │       ├─ @Public() → skip auth, next()
  │       ├─ Try strategies (JWT → API Key → Session)
  │       │   ├─ No user → onAuthFailed event, 401
  │       │   └─ User found → ctx.set('user', user), onAuthenticated event
  │       ├─ @Roles() check          → 403 on missing role
  │       ├─ @Can(action, resource)  → 403 on policy deny
  │       ├─ @RateLimit() check      → 429 + RateLimit-* headers
  │       └─ CSRF check (cookie auth + mutating method)
  │
  ├─ Express Router matches route
  │   ├─ Validation middleware (Zod schemas)
  │   ├─ File-upload middleware (@FileUpload)
  │   ├─ @Middleware() handlers (class then method)
  │   ├─ ▸ Context Contributor pipeline (#107)
  │   │   ├─ topo-sorted at boot — method > class > module > adapter > global
  │   │   ├─ each contributor's resolve() runs sequentially (await)
  │   │   ├─ return value → runner does ctx.set(reg.key, value)
  │   │   └─ on throw: optional skip / onError fallback / propagate
  │   │     (architecture.md §20.9)
  │   │
  │   └─ Controller method executes
  │       ├─ ctx.get(key)      → typed via ContextMeta
  │       ├─ getRequestValue() → same lookup from a service (no ctx)
  │       └─ ctx.json(data)    → response (or .created / .noContent / etc.)
  │
  ├─ ▸ afterRoutes adapters
  │
  └─ Response complete
```

Three layers each construct their own `RequestContext` — `@Middleware`, the contributor wrapper, and the main handler. They all share the same per-request bag through the `AsyncLocalStorage` frame opened in step 4. See [Context Decorators → How values flow](./context-decorators.md#how-values-flow-instances-als-and-what-survives) for the per-instance details and the why.

## Adapter Lifecycle Hooks

Adapters built with `defineAdapter()` participate in the application lifecycle through these hooks. Every hook is optional — implement only what you need:

```
Setup Phase                  Runtime Phase                Shutdown Phase
─────────────                ─────────────                ──────────────
beforeMount(ctx)             middleware: beforeGlobal      SIGTERM/SIGINT
     │                       middleware: afterGlobal             │
middleware()                 middleware: beforeRoutes      shutdown()
     │                       middleware: afterRoutes       (close DB, flush logs)
contributors()
     │
onRouteMount(ctrl, path)
     │
beforeStart(ctx)
     │
                             afterStart(ctx)              ← server listening
```

| Hook | When | Example use |
|------|------|-------------|
| `beforeMount(ctx)` | Before any middleware is registered | Mount routes that bypass the middleware stack (health, docs UI, OAuth callbacks) |
| `middleware()` | Returns middleware tagged with a phase | Auth checks, header parsing, CSRF, rate-limit enforcement |
| `contributors()` | Per-route, at mount time | Ship typed [Context Contributors](./context-decorators.md) at the `'adapter'` precedence level |
| `onRouteMount(ctrl, path)` | After each module's routes are mounted | OpenAPI spec generation, dependency-graph collection, route inventory |
| `beforeStart(ctx)` | After all routes mounted, before server listens | Log config summary, validate setup, late-stage DI |
| `afterStart(ctx)` | After the HTTP server is listening | Attach upgrade handlers (Socket.IO, gRPC), warm caches |
| `shutdown()` | On SIGTERM/SIGINT | Close DB pools, flush logs, disconnect WS — runs concurrently via `Promise.allSettled` |

See [Adapters](./adapters.md) for the full `defineAdapter()` reference.

## Middleware Phases

Adapter middleware runs at specific phases in the pipeline:

| Phase | Order | Typical adapter |
|-------|-------|----------------|
| `beforeGlobal` | Before user middleware | Cross-cutting scope adapters (tracing, locale, tenant/workspace) |
| `afterGlobal` | After user middleware | — |
| `beforeRoutes` | Before Express router | AuthAdapter, rate limiters, request validators |
| `afterRoutes` | After Express router | SwaggerAdapter (serve OpenAPI spec), tail-end logging |

Phases execute in order. Within a phase, adapters run in the order they appear in the `adapters` array — order matters when one adapter writes a value the next one reads. For most cases prefer a Context Contributor with `dependsOn` over relying on adapter ordering, since `dependsOn` validates at boot.

## RequestContext

The `RequestContext` (alias `Ctx<T>`) wraps Express `req`/`res` and is constructed per middleware/handler layer that needs it. The `get` / `set` accessors read and write the same per-request bag every layer shares (via the `AsyncLocalStorage` frame):

```
RequestContext
├─ ctx.user            ← reads from request bag, falls back to req.user
├─ ctx.body            ← parsed request body
├─ ctx.params          ← route parameters
├─ ctx.query           ← query string
├─ ctx.headers         ← request headers
├─ ctx.session         ← session data (if session middleware)
├─ ctx.requestId       ← X-Request-Id header
├─ ctx.get(key)        ← typed read via augmented ContextMeta
├─ ctx.set(key, value) ← typed write via augmented ContextMeta
├─ ctx.json(data)      ← 200 response
├─ ctx.created(data)   ← 201 response
├─ ctx.noContent()     ← 204 response
├─ ctx.notFound()      ← 404 response
└─ ctx.paginate(fn)    ← auto-paginated response
```

Type `ctx.get()` and `ctx.set()` via module augmentation:

```ts
declare module '@forinda/kickjs' {
  interface ContextMeta {
    user: { id: string; email: string; roles: string[] }
    locale: { language: string; region: string | null }
  }
}
```

Services that don't hold a `ctx` reference read the same bag via `getRequestValue(key)` (typed) or `getRequestStore()` (full record including `requestId`). The framework intentionally does NOT expose a service-level write helper — writes flow through `ctx.set` or a Context Contributor's return value, so the per-request bag isn't polluted from arbitrary places. See [Context Decorators → Reading the same value from a service](./context-decorators.md#reading-the-same-value-from-a-service-no-ctx-in-scope).

## See Also

- [Adapters](./adapters.md) — writing custom adapters with `defineAdapter()`
- [Plugins](./plugins.md) — bundling modules + adapters + middleware via `definePlugin()`
- [Context Decorators](./context-decorators.md) — typed per-request values + contributor pipeline
- [Authentication](./authentication.md) — AuthAdapter strategies and decorators
- [Authorization](./authorization.md) — @Policy, @Can, @Roles
- [Multi-Tenancy](./multi-tenancy.md) — TenantAdapter and database switching
- [Middleware](./middleware.md) — custom middleware
