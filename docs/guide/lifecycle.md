# Request Lifecycle

KickJS processes every request through a deterministic pipeline of middleware phases, adapter hooks, contributor resolution, and handler execution. Understanding this flow tells you exactly where your code runs and in what order — and where to plug in to extend it.

## Bootstrap Sequence

When `bootstrap()` is called, the application is assembled in this order:

```text
 1. Adapter beforeMount hooks            (mount early routes that bypass middleware)
 2. Hardened defaults                    (disable x-powered-by, trust proxy)
 3. In-flight request tracking           (drains on shutdown)
 4. Request scope (AsyncLocalStorage)    (requestScopeMiddleware)
 5. Adapter middleware: beforeGlobal     (e.g. tracing / scope-resolving adapters)
 6. Plugin registration + middleware
 7. Security defaults (auto-helmet)
 8. User middleware (cors, json, session, etc.)
 9. Adapter middleware: afterGlobal
10. Module registration + DI bootstrap   (incl. the built-in health module)
11. Adapter middleware: beforeRoutes     (e.g. rate limit, request validators)
12. Mount module routes                  (onRouteMount notifies adapters per controller)
13. Adapter middleware: afterRoutes
14. Adapter beforeStart hooks            (final DI registrations, log banner)
15. Error handlers (404 + global)
16. HTTP server listen                   (then afterStart hooks fire)
```

Steps 5 and 11 are where most adapter logic runs. Adapters resolving cross-cutting per-request
state (locale, tenant/workspace scope, geo, feature flags) typically run at `beforeGlobal`.

Note what step 11 is **not**: `beforeRoutes` runs before route _matching_, so middleware there sees
every request including ones that match no route. That is right for an abuse control and wrong for
anything that needs to know which handler it is protecting — those belong in `@Middleware()` or a
contributor, where `ctx.route` exists.

## Request Flow

Every incoming request flows through this pipeline. The step numbers match the
`── n.` markers in `Application.setup()`, so the code and this diagram stay
readable against each other.

```text
Request In
  │
  ├─ In-flight request tracking (drains on shutdown)
  ├─ AsyncLocalStorage scope opened  ← the per-request bag every layer shares
  │
  ├─ ▸ adapter middleware: beforeGlobal
  ├─ Plugin middleware
  ├─ Global middleware (helmet, cors, requestId, body parsers, your own)
  │   └─ Runs BEFORE a route is matched, so `ctx.route` is undefined here.
  │      Pre-match middleware that needs route flags (rateLimit) reads them
  │      from the boot-built policy table instead.
  ├─ ▸ adapter middleware: afterGlobal
  ├─ ▸ adapter middleware: beforeRoutes
  │
  ├─ The runtime matches a route  (Express / Fastify / h3 — same table, own engine)
  │   │
  │   ├─ Publish the matched route → `ctx.route` is now readable
  │   │   └─ method, path, controller, handlerName, and flags resolved at boot
  │   ├─ Validation middleware (schema on the route decorator)
  │   ├─ File-upload middleware (@FileUpload)
  │   ├─ @Middleware() handlers — class first, then method
  │   │   └─ guards live here: read `ctx.route.flags`, answer with ctx.problem.*
  │   ├─ ▸ Context Contributor pipeline
  │   │   ├─ topo-sorted at boot — method > class > module > adapter > global
  │   │   ├─ `skipWhen` / `onlyWhen` consult the route's flags first
  │   │   ├─ each contributor's resolve() runs sequentially (await)
  │   │   ├─ return value → runner does ctx.set(reg.key, value)
  │   │   └─ on throw: optional skip / onError fallback / propagate
  │   │
  │   └─ Controller method executes
  │       ├─ ctx.get(key)      → typed via ContextMeta
  │       ├─ getRequestValue() → same lookup from a service (no ctx)
  │       └─ return payload, or ctx.json(data) / .created / .noContent
  │
  ├─ ▸ adapter middleware: afterRoutes
  ├─ Error + not-found handlers
  └─ Response complete
```

::: tip `/health` is not special
The built-in health endpoints are an **ordinary module, mounted last** — not a
short-circuit at the top of the pipeline. They pass through global middleware
like any other route, which means app-wide auth applies to them unless you
exempt the path. That is deliberate: a framework route quietly bypassing your
middleware is the bigger surprise. Mounting last also means your own `/health`
module wins if you declare one, and `health: false` skips the built-in entirely.
:::

### Where a value can be read

| You are in                        | `ctx.route`  | Route flags                 | Per-request bag        |
| --------------------------------- | ------------ | --------------------------- | ---------------------- |
| Global middleware (`middlewares`) | ❌ pre-match | policy table, if it opts in | ✅                     |
| Adapter middleware (any phase)    | ❌ pre-match | policy table, if it opts in | ✅                     |
| `@Middleware()` / guards          | ✅           | `ctx.route.flags`           | ✅                     |
| Context contributors              | ✅           | `skipWhen` / `onlyWhen`     | ✅                     |
| Controller handler                | ✅           | `ctx.route.flags`           | ✅                     |
| A service with no `ctx`           | —            | —                           | ✅ `getRequestValue()` |

The split is route matching: everything after it knows which handler it is
headed for, everything before it does not.

"Pre-match" does not mean "no flags", though — it means no `ctx.route`. Middleware
that runs before matching can still read a route's flags by opting into the
**policy table**, which records every mounted route's flags at boot;
`rateLimit({ exemptWhen })` does exactly that, and your own middleware can via
`bindRoutePolicy`. What it cannot do is know which handler it is headed for,
because nothing has matched yet. See [Route Flags](./route-flags.md).

### One context, or several

Under Express the framework constructs a **new `RequestContext` per layer**
(middleware step, contributor wrapper, handler); Fastify and h3 build one per
request. Both are correct, because per-request state does not live on the ctx
instance — `ctx.get` / `ctx.set` read the `AsyncLocalStorage` frame opened at the
top of the pipeline, and `ctx.route` is published on the request object.

It matters when you write a framework-level feature: state stashed on a `ctx`
instance survives on Fastify and h3 and vanishes on Express. See
[Context Decorators → How values flow](./context-decorators.md#how-values-flow-instances-als-and-what-survives).

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

| Hook                       | When                                            | Example use                                                                                    |
| -------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `beforeMount(ctx)`         | Before any middleware is registered             | Mount routes that bypass the middleware stack (health, docs UI, OAuth callbacks)               |
| `middleware()`             | Returns middleware tagged with a phase          | Auth checks, header parsing, CSRF, rate-limit enforcement                                      |
| `contributors()`           | Per-route, at mount time                        | Ship typed [Context Contributors](./context-decorators.md) at the `'adapter'` precedence level |
| `onRouteMount(ctrl, path)` | After each module's routes are mounted          | OpenAPI spec generation, dependency-graph collection, route inventory                          |
| `beforeStart(ctx)`         | After all routes mounted, before server listens | Log config summary, validate setup, late-stage DI                                              |
| `afterStart(ctx)`          | After the HTTP server is listening              | Attach upgrade handlers (Socket.IO, gRPC), warm caches                                         |
| `shutdown()`               | On SIGTERM/SIGINT **and on every HMR rebuild**  | Close DB pools, flush logs, disconnect WS — runs concurrently via `Promise.allSettled`         |

Per-request teardown is separate from process shutdown: a REQUEST-scoped
service method decorated with `@PreDestroy()` runs when its request's scope
closes (response finished or aborted) — the counterpart to `@PostConstruct`.
See [Dependency Injection → Lifecycle Hooks](./dependency-injection.md#predestroy).

See [Adapters](./adapters.md) for the full `defineAdapter()` reference.

## Middleware Phases

Adapter middleware runs at specific phases in the pipeline:

| Phase          | Order                  | Typical adapter                                                  |
| -------------- | ---------------------- | ---------------------------------------------------------------- |
| `beforeGlobal` | Before user middleware | Cross-cutting scope adapters (tracing, locale, tenant/workspace) |
| `afterGlobal`  | After user middleware  | —                                                                |
| `beforeRoutes` | Before route matching  | Rate limiters, request validators                                |
| `afterRoutes`  | After route matching   | SwaggerAdapter (serve OpenAPI spec), tail-end logging            |

Phases execute in order. Within a phase, adapters run in the order they appear in the `adapters` array — order matters when one adapter writes a value the next one reads. For most cases prefer a Context Contributor with `dependsOn` over relying on adapter ordering, since `dependsOn` validates at boot.

## RequestContext

The `RequestContext` (alias `Ctx<T>`) is the engine-neutral request surface — it wraps whatever the active runtime hands it (Express `req`/`res`, a Fastify request/reply, an h3 event) and is constructed per layer that needs one. The `get` / `set` accessors read and write the same per-request bag every layer shares (via the `AsyncLocalStorage` frame):

```
RequestContext
├─ ctx.route           ← matched route + its flags (undefined pre-match)
├─ ctx.user            ← reads from request bag, falls back to req.user
├─ ctx.body            ← parsed request body
├─ ctx.params          ← route parameters
├─ ctx.query           ← query string
├─ ctx.qs(config)      ← parsed filters / sort / pagination
├─ ctx.headers         ← request headers
├─ ctx.ip              ← client IP, resolved per runtime
├─ ctx.session         ← session data (if session middleware)
├─ ctx.requestId       ← X-Request-Id header
├─ ctx.file / ctx.files ← uploads (@FileUpload)
├─ ctx.get(key)        ← typed read via augmented ContextMeta
├─ ctx.set(key, value) ← typed write via augmented ContextMeta
├─ ctx.setHeader(k, v) ← response header, runtime-neutral
├─ ctx.json(data)      ← 200 response
├─ ctx.created(data)   ← 201 response
├─ ctx.noContent()     ← 204 response
├─ ctx.notFound()      ← 404 response
├─ ctx.problem.*       ← RFC 9457 problem responses
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
- [Authentication](./authentication.md) — BYO auth via context decorators
- [Authorization](./authorization.md) — BYO role checks + policy engine via DI
- [Multi-Tenancy](./multi-tenancy.md) — TenantAdapter and database switching
- [Middleware](./middleware.md) — custom middleware
- [Route Flags](./route-flags.md) — per-route facts read by guards, contributors and pre-match middleware
- [HTTP Runtimes](./http-runtimes.md) — what changes when the engine does
