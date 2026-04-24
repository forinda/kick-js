# Request Lifecycle

KickJS processes every request through a deterministic pipeline of middleware phases, adapter hooks, and handler execution. Understanding this flow helps you know exactly where your code runs and in what order.

## Bootstrap Sequence

When `bootstrap()` is called, the application is assembled in this order:

```
 1. Adapter beforeMount hooks
 2. Hardened defaults (disable x-powered-by, trust proxy)
 3. Request tracking + health endpoints
 4. Request scope (AsyncLocalStorage)
 5. Adapter middleware: beforeGlobal     ← TenantAdapter runs here
 6. Plugin registration + middleware
 7. Security defaults (auto-helmet)
 8. User middleware (cors, json, session, etc.)
 9. Adapter middleware: afterGlobal
10. Module registration + DI bootstrap
11. Adapter middleware: beforeRoutes     ← AuthAdapter runs here
12. Mount module routes (onRouteMount notifies adapters)
13. Adapter middleware: afterRoutes
14. Error handlers (404 + global)
15. Adapter beforeStart hooks
16. HTTP server listen
```

Steps 5 and 11 are where most adapter logic runs. TenantAdapter resolves the tenant before any auth happens. AuthAdapter protects routes before Express matches them.

## Request Flow

Every incoming request flows through this pipeline:

```
Request In
  │
  ├─ Request tracking (in-flight counter)
  ├─ Health check? (/health, /ready) → 200 OK (short-circuit)
  ├─ AsyncLocalStorage scope
  │
  ├─ ▸ beforeGlobal adapters
  │   └─ TenantAdapter
  │       ├─ Resolve tenant (subdomain / header / custom)
  │       ├─ Tenant found → req.tenant, onTenantResolved, AsyncLocalStorage.run()
  │       ├─ Not found + required → 403
  │       └─ Not found + optional → continue
  │
  ├─ Plugin middleware
  ├─ Security headers (helmet)
  ├─ User middleware (cors, json, session, etc.)
  ├─ ▸ afterGlobal adapters
  │
  ├─ ▸ beforeRoutes adapters
  │   └─ AuthAdapter
  │       ├─ Resolve controller + method from URL
  │       ├─ @Public() → skip auth, next()
  │       ├─ Try strategies (JWT → API Key → Session)
  │       │   ├─ No user → onAuthFailed event, 401
  │       │   └─ User found → req.user, onAuthenticated event
  │       │
  │       ├─ Tenant RBAC (if req.tenant + roleResolver)
  │       │   └─ user.tenantRoles = resolved roles
  │       │
  │       ├─ @Roles() check
  │       │   └─ Missing role → onForbidden event, 403
  │       │
  │       ├─ @Can(action, resource) policy check
  │       │   └─ Policy denies → 403
  │       │
  │       ├─ @RateLimit() check
  │       │   └─ Exceeded → 429 + RateLimit-* headers
  │       │
  │       └─ CSRF check (if cookie auth + mutating method)
  │           ├─ @CsrfExempt() → skip
  │           └─ Header ≠ cookie → 403
  │
  ├─ Express Router matches route
  │   ├─ Validation middleware (Zod schemas)
  │   ├─ File-upload middleware (@FileUpload)
  │   ├─ @Middleware() handlers (class then method)
  │   ├─ ▸ Context Contributor pipeline (#107)
  │   │   ├─ topo-sorted at boot — method > class > module > adapter > global
  │   │   ├─ each contributor's resolve() runs sequentially (await)
  │   │   ├─ ctx.set(key, value) writes flow into requestStore.values
  │   │   └─ optional / onError matrix on resolve throws (architecture.md §20.9)
  │   │
  │   └─ RequestContext created → Controller method executes
  │       └─ Response (ctx.json, ctx.created, etc.)
  │
  ├─ ▸ afterRoutes adapters
  │
  └─ Response complete
```

## Adapter Lifecycle Hooks

Adapters participate in the application lifecycle through these hooks:

```
Setup Phase                  Runtime Phase              Shutdown Phase
─────────────                ─────────────              ──────────────
beforeMount(ctx)             beforeGlobal middleware     SIGTERM/SIGINT
     │                       afterGlobal middleware           │
middleware()                 beforeRoutes middleware     shutdown()
     │                       afterRoutes middleware      (close DB, flush logs)
onRouteMount(ctrl, path)
     │
beforeStart(ctx)
```

| Hook | When | Example Use |
|------|------|-------------|
| `beforeMount(ctx)` | Before any middleware is registered | Register DI tokens, connect databases |
| `middleware()` | Returns middleware tagged with a phase | Auth checks, tenant resolution, CSRF |
| `onRouteMount(ctrl, path)` | After each module's routes are mounted | Swagger spec generation, auth metadata collection |
| `beforeStart(ctx)` | After all routes mounted, before server listens | Log config summary, validate setup |
| `shutdown()` | On SIGTERM/SIGINT | Close DB pools, flush logs, disconnect WS |

## Middleware Phases

Adapter middleware runs at specific phases in the pipeline:

| Phase | Order | Typical Adapter |
|-------|-------|----------------|
| `beforeGlobal` | Before user middleware | TenantAdapter (tenant resolution) |
| `afterGlobal` | After user middleware | — |
| `beforeRoutes` | Before Express router | AuthAdapter (auth + CSRF + rate limit) |
| `afterRoutes` | After Express router | SwaggerAdapter (serve OpenAPI spec) |

Phases execute in order. Within a phase, adapters run in the order they appear in the `adapters` array — **TenantAdapter must come before AuthAdapter** so `req.tenant` is available for tenant-scoped RBAC.

## RequestContext

The `RequestContext` (alias `Ctx<T>`) wraps Express `req`/`res` and is created per controller method:

```
RequestContext
├─ ctx.user            ← from req.user or ContextMeta
├─ ctx.body            ← parsed request body
├─ ctx.params          ← route parameters
├─ ctx.query           ← query string
├─ ctx.headers         ← request headers
├─ ctx.session         ← session data (if session middleware)
├─ ctx.requestId       ← X-Request-Id header
├─ ctx.get(key)        ← typed metadata (via ContextMeta)
├─ ctx.set(key, value) ← typed metadata (via ContextMeta)
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
    tenant: { id: string; name: string }
  }
}
```

## See Also

- [Adapters](/guide/adapters) — writing custom adapters
- [Authentication](/guide/authentication) — AuthAdapter strategies and decorators
- [Authorization](/guide/authorization) — @Policy, @Can, @Roles
- [Multi-Tenancy](/guide/multi-tenancy) — TenantAdapter and database switching
- [Middleware](/guide/middleware) — custom middleware
