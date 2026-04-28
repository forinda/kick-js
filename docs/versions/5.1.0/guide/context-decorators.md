# Context Decorators

Context decorators are a typed, ordered, declarative way to populate `ctx.set('key', value)` *before* a controller handler runs. They replace hand-written middleware whose only job is "compute X and stash it on the request".

Good fits span well beyond multi-tenancy — anything you repeatedly compute from the incoming request is a candidate:

- request-tracing metadata (`requestStartedAt`, span / trace id)
- locale / timezone resolved from headers or user prefs
- feature flags / experiment buckets
- rate-limit or idempotency-key derivation
- geo or device info from CDN headers
- workspace / organisation / project scoping for collaboration apps
- warmed user profile or permission sets from a cache
- whatever per-request value your handlers keep re-deriving

```ts
@ResolveLocale
@LoadFeatureFlags   // depends on 'locale' — runs after ResolveLocale automatically
@Get('/home')
home(ctx: RequestContext) {
  ctx.get('locale')        // typed via ContextMeta, guaranteed present
  ctx.get('featureFlags')  // typed via ContextMeta, guaranteed present
}
```

Compared to writing two custom middlewares for the same job, you get:

- **Type safety** — `ctx.get('locale')` returns the type you declared in `ContextMeta`, not `any`.
- **Ordering enforced at startup** — declare `dependsOn` and the framework topo-sorts; cycles and missing dependencies fail boot, not requests.
- **DI integration** — the resolver receives a typed `deps` object resolved from the container.
- **Reusable across registration sites** — the same decorator works on a method, a class, a module, an adapter, or globally in `bootstrap()`.

## When to use

Use a context decorator when:

- The middleware's only output is a value other code reads off `ctx`.
- You want type safety on that value.
- The value depends on another value computed by an earlier middleware.

Stick with `@Middleware()` (or raw Express middleware) when:

- The handler short-circuits the response (`res.status(403).end()`).
- It manipulates the response stream (compression, body parsing).
- It runs before route matching (CORS, Helmet, request logging).

See [Middleware vs context decorators](./middleware.md#middleware-vs-context-decorators).

## Ten use cases — and why contributors beat middleware

Anything you repeatedly compute from the incoming request is a candidate. The pattern is NOT multi-tenancy-specific — here are ten distinct domains where contributors remove a lot of boilerplate, with the rationale for each:

| # | Use case | Typical key + shape | Why it wins over middleware |
|---|---|---|---|
| 1 | **Request tracing** — timestamp / trace id / span id for every handler and service on the chain | `requestStartedAt: number`, `traceId: string` | Transport-agnostic (HTTP + WS + queue + cron share the same primitive). Services read via `getRequestValue('traceId')` without a `ctx` reference. |
| 2 | **Locale / i18n negotiation** — resolve from `Accept-Language`, user prefs, cookie, in that order | `locale: { language: string; region: string \| null }` | Typed once via `ContextMeta`, never re-derived. Replaced per-route (a `/admin` endpoint forces `en`) without forking the middleware stack. |
| 3 | **Feature flags** — evaluate flags once, cache the result for the request's lifetime | `featureFlags: Record<string, boolean>` | `deps: { flags: FLAG_SERVICE }` pulls the evaluator from DI — no `container.getInstance()` boilerplate. `dependsOn: ['featureFlags']` downstream gives guaranteed-present flags. |
| 4 | **A/B test bucket assignment** — stable-hash the user into a variant, reusing feature-flag state | `abBucket: 'control' \| 'variantA' \| 'variantB'` | `dependsOn` encodes the "flags must resolve first" relationship once; framework topo-sorts. Middleware order bugs (forgetting to mount B before C) become startup errors, not silent 500s. |
| 5 | **Rate-limit key derivation** — combine user id + IP + route to produce the limiter key | `rateLimitKey: string` | The contributor returns one string; the downstream rate-limit middleware reads it and does the enforcement. Separation of computation (typed, tested) from enforcement (side-effectful). |
| 6 | **Idempotency key validation** — pluck `Idempotency-Key` header, reject mutations missing it | `idempotencyKey: string \| null` | `onError` captures the "missing on POST/PUT" case cleanly — return `null` or throw, per your policy. Pipeline enforces the check at boot: forgetting to mount it globally is surfaced by TypeScript if another contributor `dependsOn`s it. |
| 7 | **Geolocation from CDN headers** — parse Cloudflare / Fastly / Vercel headers once | `geo: { country \| null; city \| null; lat \| null; lng \| null }` | Adapter authors ship `@ResolveGeo` + `GeoAdapter` — adopters pick per-route opt-in OR cross-cutting activation. No "wrap the app in a context provider" boilerplate. |
| 8 | **Workspace / organisation / project scoping** — resolve the active scope from URL param or header | `workspace: { id; name; members }` (or `org`, `project`, `team`, `room` — whatever your domain calls it) | Not just a tenant loader. Any scoped app (collab tools, chat, kanban, CI) owns its scope name. Multi-level scoping (`workspace` → `project` → `task`) composes via `dependsOn`. |
| 9 | **Warmed user profile / permission set** — read once from cache, share across handler + services | `user: { id; email; roles }`, `permissions: Set<string>` | Auth middleware sets the user; a contributor warms the profile and cached permission set. Services read via `getRequestValue('user')` without threading the user through every method signature. |
| 10 | **Correlation ID for distributed tracing / saga state** — propagate an inbound `X-Correlation-ID`, or generate one | `correlationId: string`, `sagaContext: { step: number; …}` | The contributor runs before every route AND every queue job (same registration, different transport). Downstream logs, outbound HTTP clients, and emitted events all pick up the same id. |

### Why this is more flexible than middleware

| Middleware pattern | Contributor advantage |
|---|---|
| Mutates `req.user` / `(req as any).tenant` — all typed `any` | `ctx.get('user')` / `ctx.get('tenant')` typed via `ContextMeta` augmentation |
| Declared as an array in `bootstrap({ middleware: [...] })` — order is whatever you wrote | `dependsOn: ['x']` — topo-sorted at boot; missing deps + cycles fail startup, not per-request |
| DI access via `Container.getInstance()` inside the middleware body | `deps: { repo: TOKEN }` typed, resolved once, handed to `resolve(ctx, deps)` |
| Tested with `supertest` + the whole Express stack | `runContributor` (from `@forinda/kickjs-testing`) tests a single resolver against a stub ctx |
| Global: every route pays the cost, no opt-out per endpoint | Five precedence levels (method > class > module > adapter > global) — override per-route without forking the stack |
| HTTP-only — WebSocket / queue / cron use different lifecycles | `defineContextDecorator` (transport-agnostic) registrations reuse across every ctx the pipeline supports |
| Plugin authors ship `app.use(myMiddleware())` and hope you call it in the right spot | Plugin authors ship `MyAdapter` (which registers via `contributors?()`) AND the raw decorator — adopters pick the ergonomic |
| Augmentation (`declare global { namespace Express { interface Request { ... } } }`) leaks across every handler in the app | `ContextMeta` augmentation is typed; `defineAugmentation` advertises it in the typegen catalogue for discovery |
| Error handling: throw → 500 unless you wrote `try/catch` around every middleware | `optional: true` skips silently; `onError` hook returns a fallback value; both typed against `MetaValue<K>` |
| "Remove the rate-limit middleware on `/health`" = fork the stack or use a path check inside the middleware | Mount `@SkipRateLimit` at method level — higher precedence wins, adapter's registration silently drops for that one route |

## Quickstart

```ts
import {
  defineHttpContextDecorator,
  Controller,
  Get,
  type RequestContext,
} from '@forinda/kickjs'

// 1. Declare the value's type via ContextMeta augmentation.
//    This is what TypeScript reads to type `ctx.get('locale')`.
declare module '@forinda/kickjs' {
  interface ContextMeta {
    locale: { language: string; region: string | null }
  }
}

// 2. Define the decorator with a resolver.
//    `defineHttpContextDecorator` pre-binds `Ctx` to `RequestContext` so
//    `ctx.req`, `ctx.headers`, `ctx.params`, etc. are typed in the resolver.
const ResolveLocale = defineHttpContextDecorator({
  key: 'locale',
  resolve: (ctx) => {
    const header = (ctx.req.headers['accept-language'] as string | undefined) ?? 'en'
    const [language, region] = header.split(',')[0].trim().split('-')
    return { language, region: region ?? null }
  },
})

// 3. Apply it on a controller method (or class)
@Controller()
class HomeController {
  @ResolveLocale
  @Get('/')
  home(ctx: RequestContext) {
    const locale = ctx.get('locale')   // typed: { language: string; region: string | null }
    return ctx.json({ greeting: greetingFor(locale) })
  }
}
```

That's the whole minimum surface. The rest of this guide covers DI deps, dependency ordering, error handling, the four registration sites beyond `@`-on-method, and how to author reusable decorators inside an adapter or plugin.

::: tip Two factories, same pipeline
- **`defineHttpContextDecorator`** — recommended for HTTP work. `Ctx` is `RequestContext`, so the resolver can read `ctx.req` / `ctx.headers` / `ctx.params` / `ctx.body` directly.
- **`defineContextDecorator`** — transport-agnostic. `Ctx` defaults to the smaller `ExecutionContext` surface (`get` / `set` / `requestId`). Use this when authoring a contributor that needs to run across HTTP, WebSocket, queue, and cron transports.

Both produce the same `ContributorRegistration` and run through the same pipeline. The wrapper exists purely to remove the third-generic ceremony for the common HTTP case.
:::

## Declaring dependencies (`deps`)

Resolvers can pull services out of the DI container. Declare them as a map; the runner resolves each token before calling `resolve()`:

```ts
import { createToken, defineHttpContextDecorator } from '@forinda/kickjs'

export const TENANT_REPO = createToken<TenantRepository>('app/tenants/repository')

const LoadTenant = defineHttpContextDecorator({
  key: 'tenant',
  deps: { repo: TENANT_REPO },
  resolve: async (ctx, { repo }) => {
    const id = ctx.req.headers['x-tenant-id'] as string
    return repo.findById(id)
  },
})
```

Dep values can be `InjectionToken<T>`s, class constructors, or string tokens — anything `container.resolve()` accepts. The argument shape passed to your resolver mirrors the `deps` object: `deps: { repo: TENANT_REPO }` produces `{ repo: TenantRepository }`.

If a token isn't registered when the runner tries to resolve it, the throw flows through the standard contributor [error matrix](#error-handling).

## Ordering with `dependsOn`

A contributor that needs another contributor's output declares the dependency by key:

```ts
const LoadProject = defineContextDecorator({
  key: 'project',
  dependsOn: ['tenant'],
  resolve: async (ctx) => {
    const tenant = ctx.get('tenant')!   // guaranteed present — the framework ran LoadTenant first
    return projectsRepo.findFor(tenant.id, ctx.params.id)
  },
})
```

The framework topologically sorts contributors at route mount time. Two failure modes:

- **Missing dependency.** A contributor declares `dependsOn: ['tenant']` but no other contributor produces `'tenant'` for the same route. The boot fails with `MissingContributorError` naming the dependent and the route.
- **Cycle.** Two contributors depend on each other (directly or transitively). Boot fails with `ContributorCycleError` reporting the cycle path.

Both errors are raised once during `app.setup()`, not per request. Bad pipelines fail fast.

::: tip `dependsOn` and `deps` are statically typed
- `dependsOn` is typed as `(keyof ContextMeta)[]`. Augment `ContextMeta` and the editor surfaces a string-literal autocomplete for every known key. A typo (`dependsOn: ['tenent']`) is a TS error with "Did you mean 'tenant'?" — not a boot-time `MissingContributorError`.
- `deps` is typed as `Record<string, DepValue>` where `DepValue = InjectionToken<T> | Constructor<T>`. Passing a string literal, an array, or a plain object errors at compile time instead of failing inside `container.resolve` at boot.

Both narrow gracefully — projects without any `ContextMeta` augmentation see `dependsOn` accept plain `string[]` so first-day code keeps compiling; the narrowing kicks in as soon as the first `declare module` block lands.
:::

## Error handling

When a `resolve()` throws, the runner consults two flags before deciding what to do:

| `resolve()` outcome | `optional` | `onError` defined | Behaviour |
|---|---|---|---|
| throws | `true` | — | skip the contributor; `ctx.get(key)` returns `undefined` |
| throws | `false` | yes | call `onError(err, ctx)`; returned value (if any) is stored under `key` |
| throws | `false` | no | propagate the original error to the Express error handler |
| `onError` throws | — | — | propagate the *new* error |
| `onError` returns `undefined` / `void` | — | — | skip; key remains unset |
| resolves | — | — | `ctx.set(key, value)` |

Examples:

```ts
// Best-effort: don't fail the request if the upstream is down.
const LoadFlags = defineContextDecorator({
  key: 'flags',
  optional: true,
  resolve: async () => flagsApi.fetchAll(),
})

// Recover with a cached value when the live fetch fails.
const LoadProfile = defineContextDecorator({
  key: 'profile',
  resolve: async (ctx) => liveProfileApi.get(ctx.user!.id),
  onError: async (_err, ctx) => cache.get(ctx.user!.id) ?? undefined,
})
```

`onError` may be async. Document that hooks run on the request hot path even though only on error — keep them short.

## Registration sites

A `defineContextDecorator(...)` call returns a function that works as both a decorator and a registration object. There are five places to attach it, in order of precedence (highest wins on key collision):

1. **Method decorator** — `@LoadX` on a controller method. Applies to that route only.
2. **Class decorator** — `@LoadX` on a controller class. Applies to every route on that controller.
3. **Module hook** — `AppModule.contributors?(): ContributorRegistrations`. Applies to every route mounted by that module.
4. **Adapter hook** — `AppAdapter.contributors?(): ContributorRegistrations`. Cross-cutting, applies to every route in the application.
5. **Bootstrap option** — `ApplicationOptions.contributors`. App-wide defaults, lowest precedence.

`ContributorRegistrations` is the type-erased collection alias used in every public hook — it accepts `ContributorRegistration` instances regardless of which `Ctx` they were defined against, so HTTP-typed contributors and `ExecutionContext`-typed contributors can sit in the same array without casting.

Same-precedence collisions on the same key throw `DuplicateContributorError` at boot. Cross-level collisions are silent overrides — the higher-precedence contributor wins.

```ts
// Method-level
class C {
  @LoadTenant
  @Get('/me')
  me(ctx: RequestContext) { /* ... */ }
}

// Class-level
@LoadTenant
class C { /* every method on C now sees `tenant` */ }

// Module-level
class TenantsModule implements AppModule {
  contributors() { return [LoadTenant.registration] }
  routes() { /* ... */ }
}

// Adapter-level
const TenantAdapter = defineAdapter({
  name: 'TenantAdapter',
  build: () => ({
    contributors: () => [LoadTenant.registration],
  }),
})

// Global (bootstrap)
bootstrap({
  modules,
  contributors: [LoadTenant.registration],
})
```

The `.registration` property on the returned function is the immutable `ContributorRegistration` the runner consumes. Decorator usage hides this; non-decorator usage exposes it.

## How values flow: instances, ALS, and what survives

A contributor and the controller method it feeds are typed against the **same `RequestContext` type** but they don't share the **same instance**. The framework wraps each request stage in its own `RequestContext`:

```
Express request
  ↓
[middleware wrapper]   new RequestContext(req, res, next)   ← instance #1 (per @Middleware)
  ↓
[contributor wrapper]  new RequestContext(req, res, next)   ← instance #2 (runs LoadTenant)
  ↓                    ctx.set('tenant', value)  →  writes to ALS Map
[main handler]         new RequestContext(req, res, next)   ← instance #3 (your @Get)
                       ctx.get('tenant')         →  reads from same ALS Map
```

What looks like one continuous `ctx` to your code is three separate JS objects. They all read and write the **same per-request bag** that lives inside an `AsyncLocalStorage` frame. That's how data flows from the contributor into the handler — through the ALS-backed store, not through shared object identity. Use `ctx.get` / `ctx.set` from any handler/middleware/contributor; use `getRequestValue` from services that don't hold a `ctx`.

::: details Why three `RequestContext` instances per request, not one?

Each Express middleware function receives its own fresh `(req, res, next)` triple — the framework's `@Middleware`, contributor-runner, and main-handler layers are each registered as separate Express middlewares (`router.use(...)` / `router[method](path, ...)`). At the point each one runs there's no shared closure to "reuse" an earlier `RequestContext` from.

A `RequestContext` is also bound to the layer's specific `next` callback — the function you call to advance to the *next* middleware in the chain. The contributor wrapper's `next` runs the main handler; the main handler's `next` runs the error handler. Reusing one ctx across layers would either freeze `next` to the first layer's chain (breaking error propagation) or require mutation per layer (defeating the point).

The cost is small: a `RequestContext` is one `new` allocation with three field assignments and zero hidden work. Construction is dominated by Express's own per-middleware overhead.

The cost would only matter if you wrote code that relied on object identity (`ctx.foo = X` and read it back from a downstream layer's ctx). That's the trap the [survives table](#what-survives-the-chain-and-what-doesnt) above is for — write through `ctx.set` / `ctx.get` (the ALS-backed bag), not through ctx properties, and the three-instance fact never bites.

The framework explicitly does NOT cache the ctx on `req` (e.g. `req.kickjsCtx`) because: (a) it would pollute Express's public `Request` type for non-kickjs middleware in the chain; (b) advanced adopters can layer in their own caching at the wrapper they own, but the framework shouldn't make the policy choice for them.
:::

### What survives the chain — and what doesn't

| Pattern | Survives across instances? | Why |
|---|---|---|
| `ctx.set('tenant', x)` then `ctx.get('tenant')` | ✅ yes | both go through the ALS-backed `Map` |
| `ctx.req.headers['x-tenant-id']` | ✅ yes | `req` is the underlying Express request, single instance for the whole request lifecycle |
| `ctx.user`, `ctx.tenantId`, `ctx.roles` (auth getters) | ✅ yes | the getters consult the ALS Map first, fall back to `req.user` |
| `ctx.tenant = x` (direct property assignment) | ❌ no | sticks to one instance only — the next stage's instance never sees it |
| `(ctx as any)._foo = x` | ❌ no | same — the assignment is local to one JS object |
| `req.foo = x` (mutate the underlying Express request) | ✅ yes | `req` is shared; this is the legacy escape hatch and not recommended |

### Why this matters for `onError`

The `onError` hook signature is `(err, ctx) => MaybePromise<MetaValue<K> | undefined | void>`. The runner consumes the **return value**:

```ts
const LoadTenant = defineHttpContextDecorator({
  key: 'tenant',
  onError(err, _ctx) {
    log.error(err, 'tenant load failed')
    return { id: 'unknown', name: 'Unknown' }   // ← runner does ctx.set('tenant', this)
  },
  resolve: (ctx) => ({ /* … */ }),
})
```

**Wrong:** `_ctx.tenant = { id: 'unknown', name: 'Unknown' }` — that writes a property on the contributor-stage `RequestContext`, which the handler-stage instance never sees. `ctx.get('tenant')` in the handler will be `undefined`.

**Right:** return the value. The runner calls `ctx.set(reg.key, returnedValue)` on your behalf, landing it in the shared ALS Map.

Same rule applies to `resolve` — return the value; never assign it as a property.

### Reading the same value from a service (no ctx in scope)

Services don't need a `ctx` reference to read contributor output. The framework ships two read helpers that mirror `ctx.get` from anywhere in the request graph:

```ts
import { Service, getRequestValue, getRequestStore } from '@forinda/kickjs'

@Service()
class AuditService {
  log(action: string) {
    // Typed read — `getRequestValue<K>(key)` returns `MetaValue<K> | undefined`,
    // so `tenant` is the augmented `ContextMeta['tenant']` shape (no cast).
    const tenant = getRequestValue('tenant')

    // Need `requestId`? Grab the whole record. Throws outside a request frame.
    const store = getRequestStore()

    db.audit.insert({ action, tenantId: tenant?.id, requestId: store.requestId })
  }
}
```

`getRequestValue(key)` returns `undefined` outside a request frame (background jobs, startup, tests without `requestScopeMiddleware()`) — null-tolerant by design so service code that runs in both request and non-request paths doesn't throw.

`getRequestStore()` throws if there's no active frame — use it when the call site is guaranteed to run during a request and you need the full record (`requestId`, `instances`, `values`).

::: warning Writes flow through `ctx.set`, not a service helper
The framework intentionally does NOT export a `setRequestValue` helper. Writes to the per-request bag should land via:

1. A Context Contributor's `resolve()` / `onError()` return value — the runner does `ctx.set(reg.key, value)` for you.
2. `ctx.set(key, value)` inside a controller, middleware, or contributor that holds a `RequestContext` instance.

Letting arbitrary services reach in and mutate the store from anywhere is "spooky action at a distance" — keys appear without an obvious source and tracing which service polluted what becomes a grep exercise. Services that need to publish per-request state should return the value to their caller and let *that* layer write it via `ctx.set`. If you need a service-level write surface, expose a narrow named function (`recordTrace`, `markStartTime`) on the service that captures the side effect — not a generic write helper.
:::

### Augmenting `ContextMeta`: `declare module` vs `defineAugmentation`

Two calls, two jobs, **both needed if you want both type safety and discoverability**:

| Call | What it does | What it doesn't do |
|---|---|---|
| `declare module '@forinda/kickjs' { interface ContextMeta { tenant: ... } }` | Tells **TypeScript** that `ctx.get('tenant')` returns your shape. Resolved at compile time by tsc / your IDE. | Doesn't show up anywhere else in the project. Other devs reading the codebase have to grep for `declare module`. |
| `defineAugmentation('ContextMeta', { description, example })` | Tells **`kick typegen`** to list the interface in `.kickjs/types/augmentations.d.ts` so every augmentable surface is discoverable from one place. Runtime + type-level no-op. | Doesn't actually augment anything. Skipping the `declare module` block leaves `ctx.get('tenant')` as `unknown`. |

In practice, the file pattern looks like this:

```ts
// src/adapters/tenant.adapter.ts
import { defineAdapter, defineAugmentation, defineHttpContextDecorator } from '@forinda/kickjs'

// (1) The actual augmentation — TypeScript reads this and gives you
// `ctx.get('tenant')` typed as `{ id: string; name: string; ... }`.
declare module '@forinda/kickjs' {
  interface ContextMeta {
    tenant: {
      id: string
      name: string
      plan: 'free' | 'pro' | 'enterprise'
      featureFlags: Record<string, boolean>
    }
  }
}

// (2) Catalogue entry — `kick typegen` lists this in
// `.kickjs/types/augmentations.d.ts` so other devs (and future-you)
// can browse every augmentable surface without grepping.
//
// `description` and `example` may both be multi-line — typegen
// preserves newlines when rendering the JSDoc. Drop in entire shape
// definitions or worked snippets, not just one-liners.
defineAugmentation('ContextMeta', {
  description: `Tenant resolved from the x-tenant-id header by TenantAdapter.

  Set on every request that survives the auth/tenant middleware chain.
  Read with \`ctx.get('tenant')\` in handlers; \`getRequestValue('tenant')\`
  in services that don't hold a ctx reference.`,
  example: `{
    tenant: {
      id: string
      name: string
      plan: 'free' | 'pro' | 'enterprise'
      featureFlags: Record<string, boolean>
    }
  }`,
})

const LoadTenant = defineHttpContextDecorator({
  key: 'tenant',
  resolve: (ctx) => ({ /* fetch and return the tenant */ }),
})

export const TenantAdapter = defineAdapter({
  name: 'TenantAdapter',
  build: () => ({
    contributors: () => [LoadTenant.registration],
  }),
})
```

Three traps to avoid:

- **`defineAugmentation` alone is not enough.** It's documentation. Without the `declare module` block, `ctx.get('tenant')` is typed `unknown` and you'll cast at every read site.
- **`declare module` alone works fine** — it's only the catalogue entry you give up. If your project doesn't use the catalogue, skip `defineAugmentation`.
- **Augmenting the wrong module** — `ContextMeta` lives in `@forinda/kickjs`. `AuthUser` lives in `@forinda/kickjs-auth`. The `declare module '...'` string must match the package the interface was originally declared in, or the augmentation is silently a no-op.

For huge shapes, both `description` and `example` accept multi-line strings — typegen splits on newlines and renders each line as proper JSDoc, so the catalogue stays readable for entire interface bodies, not just one-liners.

### When the same registration runs at multiple levels

The same `LoadTenant.registration` can show up at the adapter level (cross-cutting default), the module level (per-module override), and the method level (per-route override). The framework dedupes by key using the documented precedence:

```
method > class > module > adapter > global
```

Lower-precedence duplicates are silently dropped — they don't run, they don't error. That's how method-level overrides work: drop a different `defineHttpContextDecorator({ key: 'tenant', … })` on a single handler and only that one fires for that route. Adapter-level keeps applying everywhere else.

If you need to *prove* which one fired (debugging, smoke tests), have the resolvers produce distinguishable values:

```ts
// adapter-level
resolve: () => ({ name: 'tenant-from-adapter' })

// method-level (wins on this one route)
@defineHttpContextDecorator({ key: 'tenant', resolve: () => ({ name: 'tenant-from-method' }) })
@Get('/me')
me(ctx: RequestContext) {
  ctx.json({ tenant: ctx.get('tenant') })   // → { tenant: { name: 'tenant-from-method' } }
}
```

### Decorator vs `contributors?()`: same runtime, different ergonomics

| Registration site | Best for | Trade-offs |
|---|---|---|
| `@LoadX` on a method | One specific route needs an override or extra contributor | Inline, easy to spot when reading the handler |
| `@LoadX` on a class | Every route in this controller needs the same value | Avoids decorating each method individually |
| `AppModule.contributors?()` | Every route the module mounts | Keeps the controller files clean; lives next to module wiring |
| `AppAdapter.contributors?()` / `KickPlugin.contributors?()` | Cross-cutting defaults shipped by a reusable package | Apply everywhere, overridable by anything narrower |
| `bootstrap({ contributors: [...] })` | App-wide defaults you wrote in the entry file | Lowest precedence — easy to override by accident; prefer adapter-level for shared concerns |

The runtime path is identical for every site: each registration ends up in the per-route pipeline, runs through `runContributors()`, and writes via `ctx.set`. Only the precedence + scope differ.

## Authoring decorators in adapters and plugins

Plugin and adapter authors can ship reusable contributors that consumers opt into via the `contributors?()` hook:

```ts
import {
  defineAdapter,
  defineHttpContextDecorator,
  type ContributorRegistrations,
} from '@forinda/kickjs'

const TENANT_HEADER = 'x-tenant-id'

const LoadTenantFromHeader = defineHttpContextDecorator({
  key: 'tenant',
  resolve: (ctx) => ({
    id: ctx.req.headers[TENANT_HEADER] as string,
  }),
})

export const HeaderTenantAdapter = defineAdapter({
  name: 'HeaderTenantAdapter',
  build: () => ({
    contributors(): ContributorRegistrations {
      return [LoadTenantFromHeader.registration]
    },
  }),
})
```

Three considerations:

- **Augment `ContextMeta` in the adapter's types file** so consumers get `ctx.get('tenant')` typed automatically when they import the adapter:

  ```ts
  declare module '@forinda/kickjs' {
    interface ContextMeta {
      tenant: { id: string }
    }
  }
  ```

- **Use namespaced keys** for plugin-specific values to avoid collisions with app-defined keys: `'@my-plugin/state'` rather than `'state'`. Same convention as Pino fields and OpenTelemetry semantic conventions.

- **Document the override path.** Users can replace your adapter-level contributor with their own at the module, class, or method level — that's a feature, not a bug. Make it clear in the adapter README.

## Examples and recipes

Nine worked examples across different domains so you can see the pattern applies to anything per-request-computed, not just tenant resolution. Each is a complete copy-paste — imports and the `declare module` block are shown once at the top of each.

### 1. Request tracing — timestamp every handler gets

The transport-agnostic case. Produces a value every handler (and every service via `getRequestValue`) can read:

```ts
import { defineContextDecorator } from '@forinda/kickjs'

declare module '@forinda/kickjs' {
  interface ContextMeta { requestStartedAt: number }
}

const TraceStart = defineContextDecorator({
  key: 'requestStartedAt',
  resolve: () => Date.now(),
})

bootstrap({
  modules,
  contributors: [TraceStart.registration],   // global — every route, every transport
})
```

Any handler: `ctx.get('requestStartedAt')`. Any service: `getRequestValue('requestStartedAt')` (typed) — see [Reading the same value from a service](#reading-the-same-value-from-a-service-no-ctx-in-scope).

### 2. Locale negotiation from `Accept-Language`

Headers-only, no DI needed — classic middleware replacement:

```ts
import { defineHttpContextDecorator } from '@forinda/kickjs'

declare module '@forinda/kickjs' {
  interface ContextMeta {
    locale: { language: string; region: string | null; fallback: boolean }
  }
}

const ResolveLocale = defineHttpContextDecorator({
  key: 'locale',
  resolve: (ctx) => {
    const header = (ctx.req.headers['accept-language'] as string | undefined) ?? ''
    const first = header.split(',')[0]?.trim()
    if (!first) return { language: 'en', region: null, fallback: true }
    const [language, region] = first.split('-')
    return { language, region: region ?? null, fallback: false }
  },
})
```

### 3. Feature flags from a service with DI

The resolver pulls a service out of the container. Downstream contributors can `dependsOn: ['featureFlags']` to branch on them:

```ts
import { createToken, defineHttpContextDecorator } from '@forinda/kickjs'

interface FlagService { evaluate(userId: string | undefined): Promise<Record<string, boolean>> }
export const FLAG_SERVICE = createToken<FlagService>('app/flags/service')

declare module '@forinda/kickjs' {
  interface ContextMeta { featureFlags: Record<string, boolean> }
}

const LoadFeatureFlags = defineHttpContextDecorator({
  key: 'featureFlags',
  deps: { flags: FLAG_SERVICE },
  resolve: async (ctx, { flags }) => {
    const userId = ctx.req.headers['x-user-id'] as string | undefined
    return flags.evaluate(userId)
  },
  onError: () => ({}),   // fallback: no flags enabled if the service blows up
})
```

### 4. Workspace scoping for a collaboration app (not "tenant")

Same shape a tenant loader would have, but framed around a collaboration context — workspace is just one possible scope among many (organisation, team, project, community, room, board…):

```ts
import { createToken, defineHttpContextDecorator, HttpException } from '@forinda/kickjs'

interface WorkspaceRepo {
  findBySlug(slug: string): Promise<{ id: string; name: string; members: string[] } | null>
}

export const WORKSPACE_REPO = createToken<WorkspaceRepo>('app/workspaces/repository')

declare module '@forinda/kickjs' {
  interface ContextMeta {
    workspace: { id: string; name: string; members: string[] }
  }
}

const LoadWorkspace = defineHttpContextDecorator({
  key: 'workspace',
  deps: { repo: WORKSPACE_REPO },
  resolve: async (ctx, { repo }) => {
    const slug = ctx.req.params.workspaceSlug
    const ws = await repo.findBySlug(slug)
    if (!ws) throw new HttpException(404, `Workspace '${slug}' not found`)
    return ws
  },
})

@Controller()
class WorkspaceController {
  @LoadWorkspace
  @Get('/:workspaceSlug')
  show(ctx: RequestContext) {
    ctx.json({ workspace: ctx.get('workspace') })
  }
}
```

### 5. Chained lookup with `dependsOn`

`A/B test bucket` depends on `featureFlags` being resolved first. The framework topo-sorts — you declare the edge, the runner does the rest:

```ts
declare module '@forinda/kickjs' {
  interface ContextMeta { abBucket: 'control' | 'variantA' | 'variantB' }
}

const AssignAbBucket = defineHttpContextDecorator({
  key: 'abBucket',
  dependsOn: ['featureFlags'],   // typed against ContextMeta — typos are TS errors
  resolve: (ctx) => {
    const flags = ctx.get('featureFlags')!   // guaranteed by dependsOn
    if (!flags['new-checkout']) return 'control'
    // Stable per-user bucket from a hash of the user id — kept here for brevity
    const userId = ctx.req.headers['x-user-id'] as string | undefined
    return hashBucket(userId, ['variantA', 'variantB'])
  },
})

@Controller()
class CheckoutController {
  @LoadFeatureFlags
  @AssignAbBucket
  @Get('/checkout')
  show(ctx: RequestContext) {
    ctx.json({ variant: ctx.get('abBucket') })
  }
}
```

Boot fails with `MissingContributorError` if a route uses `@AssignAbBucket` without anything producing `'featureFlags'` at or above that route's precedence level.

### 6. Factory: a parameterised reusable contributor

Most reusable contributors take options. Wrap the factory:

```ts
interface IdempotencyOptions {
  /** Header carrying the client-supplied key. Default: `idempotency-key`. */
  header?: string
  /** Require the header on mutating methods? Default: `true`. */
  required?: boolean
}

export function createIdempotencyLoader(opts: IdempotencyOptions = {}) {
  const header = opts.header ?? 'idempotency-key'
  const required = opts.required ?? true

  return defineHttpContextDecorator({
    key: 'idempotencyKey',
    resolve: (ctx) => {
      const key = ctx.req.headers[header] as string | undefined
      if (!key && required && MUTATING_METHODS.has(ctx.req.method)) {
        throw new HttpException(400, `Missing ${header} header`)
      }
      return key ?? null
    },
  })
}

declare module '@forinda/kickjs' {
  interface ContextMeta { idempotencyKey: string | null }
}

// Per-route opt-in or pass to an adapter's contributors() hook
const CheckIdempotency = createIdempotencyLoader({ required: true })
```

### 7. Composition: one custom decorator that bundles several contributors

When one logical concern (`@RequiresCheckoutContext`) needs several contributors chained, bundle them. Two forms — registration bundle for module/adapter hooks, and a composed decorator for per-route/per-class use:

```ts
import type { AnyContributorRegistration } from '@forinda/kickjs'

// Adapter / module hook form — pass this array straight to contributors()
export const CheckoutContextRegistrations: AnyContributorRegistration[] = [
  LoadFeatureFlags.registration,
  AssignAbBucket.registration,
  CheckIdempotency.registration,
]

// Decorator form — apply to a method / class to attach all three at once
export function RequiresCheckoutContext(target: object, propertyKey?: string | symbol): void {
  LoadFeatureFlags(target as never, propertyKey as never)
  AssignAbBucket(target as never, propertyKey as never)
  CheckIdempotency(target as never, propertyKey as never)
}

@Controller()
class CheckoutController {
  @RequiresCheckoutContext
  @Post('/checkout')
  checkout(ctx: RequestContext) {
    const flags = ctx.get('featureFlags')
    const bucket = ctx.get('abBucket')
    const key    = ctx.get('idempotencyKey')
    ...
  }
}
```

### 8. Third-party package ships a contributor + a custom decorator wrapping it

The pattern most reusable packages will follow — expose both the registration (for `contributors?()` hooks) *and* a decorator alias (for per-route opt-in). Adopters pick the ergonomic that fits their call site:

```ts
// packages/geo/src/index.ts
import {
  defineAdapter,
  defineAugmentation,
  defineHttpContextDecorator,
} from '@forinda/kickjs'

declare module '@forinda/kickjs' {
  interface ContextMeta {
    geo: { country: string | null; city: string | null; latitude: number | null; longitude: number | null }
  }
}

defineAugmentation('ContextMeta', {
  description: 'Geolocation resolved from CDN headers (Cloudflare / Fastly / Vercel) by GeoAdapter.',
  example: `{ geo: { country: string | null; city: string | null; latitude: number | null; longitude: number | null } }`,
})

const ResolveGeo = defineHttpContextDecorator({
  key: 'geo',
  resolve: (ctx) => ({
    country: (ctx.req.headers['cf-ipcountry'] as string | undefined) ?? null,
    city:    (ctx.req.headers['cf-ipcity']    as string | undefined) ?? null,
    latitude:  parseOrNull(ctx.req.headers['cf-iplatitude']),
    longitude: parseOrNull(ctx.req.headers['cf-iplongitude']),
  }),
})

// Public API
export { ResolveGeo }
export const GeoAdapter = defineAdapter({
  name: 'GeoAdapter',
  build: () => ({
    contributors: () => [ResolveGeo.registration],
  }),
})
```

Consumer code — pick the ergonomic:

```ts
// Cross-cutting — every route gets `geo` populated
bootstrap({ modules, adapters: [GeoAdapter()] })

// OR per-route opt-in — only this handler pays for the header read
@ResolveGeo
@Get('/nearby')
nearby(ctx: RequestContext) {
  ctx.json({ country: ctx.get('geo')!.country })
}
```

### 9. Reading contributor output from a service that has no `ctx`

Any service can read what contributors wrote — no `ctx` parameter needed — via `getRequestValue` (typed lookup) and `getRequestStore` (full record including `requestId`):

```ts
import { Service, getRequestValue, getRequestStore } from '@forinda/kickjs'

@Service()
class AuditService {
  log(action: string) {
    const locale = getRequestValue('locale')         // typed via ContextMeta
    const geo    = getRequestValue('geo')
    const bucket = getRequestValue('abBucket')

    db.audit.insert({
      action,
      locale:     locale?.language,
      geoCountry: geo?.country,
      bucket,
      requestId:  getRequestStore().requestId,
    })
  }
}
```

`getRequestValue(key)` returns `MetaValue<K> | undefined` — null-tolerant, so service code that runs in both request and non-request paths doesn't throw. `getRequestStore()` throws if there's no active frame; use it when you need `requestId` and the call site is guaranteed to be inside a request.

Writes still flow through `ctx.set` (or a contributor's return value) — see the warning in [Reading the same value from a service](#reading-the-same-value-from-a-service-no-ctx-in-scope) for why services don't get a service-level write helper.

### Overriding an adapter-shipped contributor for one route

The precedence rule (method > class > module > adapter > global) lets you replace a cross-cutting default per-route without touching the adapter:

```ts
// GeoAdapter is mounted globally — real CDN header reads on every route.
// For a health-check endpoint we don't want the CDN lookup (it'll be null
// anyway behind a load balancer), so stub it at the method level:

const StubGeo = defineHttpContextDecorator({
  key: 'geo',
  resolve: () => ({ country: null, city: null, latitude: null, longitude: null }),
})

@StubGeo              // wins — adapter version silently dropped for this route
@Get('/health')
health(ctx: RequestContext) {
  ctx.json({ ok: true })
}
```

## Testing contributors

Two scopes, two test helpers from `@forinda/kickjs-testing`:

| Scope | Helper | Use when |
|---|---|---|
| Unit — one contributor in isolation | `runContributor(decorator, opts)` | Asserting the resolver's pure logic (input → output), mocking deps, pre-seeding `dependsOn` keys |
| Integration — full pipeline + handler | `createTestApp({ modules })` + `supertest` | Asserting the handler actually sees the contributor's value, multi-contributor topo-order, route-level overrides |

### Unit: a bare contributor

```ts
import { describe, it, expect } from 'vitest'
import { defineHttpContextDecorator } from '@forinda/kickjs'
import { runContributor } from '@forinda/kickjs-testing'

declare module '@forinda/kickjs' {
  interface ContextMeta {
    locale: { language: string; region: string | null }
  }
}

const ResolveLocale = defineHttpContextDecorator({
  key: 'locale',
  resolve: (ctx) => {
    const header = (ctx.req.headers['accept-language'] as string | undefined) ?? 'en'
    const [language, region] = header.split(',')[0].trim().split('-')
    return { language, region: region ?? null }
  },
})

describe('ResolveLocale', () => {
  it('parses Accept-Language', async () => {
    const { value } = await runContributor(ResolveLocale, {
      // The fake ctx exposes only the ExecutionContext surface by default;
      // for HTTP-typed contributors that read `ctx.req`, pass the request
      // shape through the `ctx` override. See runContributor's API docs.
      ctx: { req: { headers: { 'accept-language': 'en-GB,en;q=0.9' } } },
    })
    expect(value).toEqual({ language: 'en', region: 'GB' })
  })

  it('falls back when the header is missing', async () => {
    const { value } = await runContributor(ResolveLocale, {
      ctx: { req: { headers: {} } },
    })
    expect(value).toEqual({ language: 'en', region: null })
  })
})
```

### Unit: a contributor with `deps`

Mock each declared dep — the runner doesn't touch the container, so you hand it the resolved instance directly:

```ts
import { createToken, defineHttpContextDecorator, HttpException } from '@forinda/kickjs'
import { runContributor } from '@forinda/kickjs-testing'

interface FlagService {
  evaluate(userId: string | undefined): Promise<Record<string, boolean>>
}
const FLAG_SERVICE = createToken<FlagService>('app/flags/service')

declare module '@forinda/kickjs' {
  interface ContextMeta { featureFlags: Record<string, boolean> }
}

const LoadFeatureFlags = defineHttpContextDecorator({
  key: 'featureFlags',
  deps: { flags: FLAG_SERVICE },
  resolve: async (ctx, { flags }) => {
    const userId = ctx.req.headers['x-user-id'] as string | undefined
    return flags.evaluate(userId)
  },
})

it('passes the user id from the header to the flag service', async () => {
  const flags: FlagService = {
    evaluate: vi.fn(async () => ({ beta: true })),
  }
  const { value } = await runContributor(LoadFeatureFlags, {
    ctx: { req: { headers: { 'x-user-id': 'u-42' } } },
    deps: { flags },
  })
  expect(flags.evaluate).toHaveBeenCalledWith('u-42')
  expect(value).toEqual({ beta: true })
})
```

### Unit: a contributor with `dependsOn`

Pre-seed the upstream key via `initial` — the runner doesn't run the upstream contributor, but `ctx.get(upstreamKey)` returns whatever you put there:

```ts
import { defineHttpContextDecorator } from '@forinda/kickjs'
import { runContributor } from '@forinda/kickjs-testing'

declare module '@forinda/kickjs' {
  interface ContextMeta {
    locale: { language: string; region: string | null }
    greeting: string
  }
}

const Greet = defineHttpContextDecorator({
  key: 'greeting',
  dependsOn: ['locale'],
  resolve: (ctx) => {
    const { language } = ctx.get('locale')!   // guaranteed by dependsOn at runtime
    return language === 'fr' ? 'Bonjour' : 'Hello'
  },
})

it('reads the upstream locale and greets accordingly', async () => {
  const { value } = await runContributor(Greet, {
    initial: { locale: { language: 'fr', region: null } },
  })
  expect(value).toBe('Bonjour')
})
```

### Unit: testing `onError` fallback

`runContributor` calls `resolve()` directly — for the `optional` skip and `onError` paths, build a one-contributor pipeline and run it through `runContributors` from `@forinda/kickjs`:

```ts
import { buildPipeline, runContributors, Container } from '@forinda/kickjs'
import { defineHttpContextDecorator } from '@forinda/kickjs'

const Tenant = defineHttpContextDecorator({
  key: 'tenant',
  onError: () => ({ id: 'unknown', name: 'Anonymous' }),
  resolve: () => { throw new Error('lookup failed') },
})

it('falls back to the onError return value when resolve throws', async () => {
  const pipeline = buildPipeline([{ source: 'method', registration: Tenant.registration }])
  const container = Container.create()
  const meta = new Map<string, unknown>()
  const ctx = {
    requestId: 't-req',
    get: (k: string) => meta.get(k),
    set: (k: string, v: unknown) => void meta.set(k, v),
  } as never

  await runContributors({ pipeline, ctx, container })
  expect(meta.get('tenant')).toEqual({ id: 'unknown', name: 'Anonymous' })
})

it('skips an optional contributor that throws', async () => {
  const Flaky = defineHttpContextDecorator({
    key: 'flaky',
    optional: true,
    resolve: () => { throw new Error('nope') },
  })
  const pipeline = buildPipeline([{ source: 'method', registration: Flaky.registration }])
  const container = Container.create()
  const meta = new Map<string, unknown>()
  const ctx = { requestId: 'r', get: (k: string) => meta.get(k), set: (k: string, v: unknown) => void meta.set(k, v) } as never

  await runContributors({ pipeline, ctx, container })
  expect(meta.has('flaky')).toBe(false)
})
```

### Integration: handler reads what the contributor wrote

Bring the whole stack up with `createTestApp` and verify the value end-to-end through `supertest`:

```ts
import { describe, it, expect } from 'vitest'
import supertest from 'supertest'
import { createTestApp } from '@forinda/kickjs-testing'
import { defineHttpContextDecorator, Controller, Get, type RequestContext, buildRoutes } from '@forinda/kickjs'

declare module '@forinda/kickjs' {
  interface ContextMeta { locale: { language: string; region: string | null } }
}

const ResolveLocale = defineHttpContextDecorator({
  key: 'locale',
  resolve: (ctx) => {
    const header = (ctx.req.headers['accept-language'] as string | undefined) ?? 'en'
    const [language, region] = header.split(',')[0].trim().split('-')
    return { language, region: region ?? null }
  },
})

@Controller()
class HomeController {
  @ResolveLocale
  @Get('/')
  home(ctx: RequestContext) {
    ctx.json({ locale: ctx.get('locale') })
  }
}

class HomeModule {
  routes() { return { path: '/', router: buildRoutes(HomeController), controller: HomeController } }
}

describe('locale contributor — integration', () => {
  it('handler sees the parsed locale from the request', async () => {
    const { expressApp } = createTestApp({ modules: [HomeModule] })
    const res = await supertest(expressApp)
      .get('/api/v1/')
      .set('Accept-Language', 'fr-CA')
      .expect(200)
    expect(res.body.locale).toEqual({ language: 'fr', region: 'CA' })
  })
})
```

### Integration: a method-level contributor overrides an adapter-level one

Verify the precedence rule fires the way you expect — the override produces a distinct value the test can assert on:

```ts
const StubLocale = defineHttpContextDecorator({
  key: 'locale',
  resolve: () => ({ language: 'en', region: null }),  // forced default
})

@Controller()
class StaticController {
  @StubLocale                           // method wins over the global ResolveLocale
  @Get('/static')
  page(ctx: RequestContext) {
    ctx.json({ locale: ctx.get('locale') })
  }
}

it('method-level override beats the global contributor', async () => {
  const { expressApp } = createTestApp({
    modules: [StaticModule],
    contributors: [ResolveLocale.registration],     // global
  })
  const res = await supertest(expressApp)
    .get('/api/v1/static')
    .set('Accept-Language', 'fr-CA')                // would be `fr` under the global
    .expect(200)
  expect(res.body.locale).toEqual({ language: 'en', region: null })
})
```

### Integration: `MissingContributorError` at boot

Bad pipelines fail fast — contributors with `dependsOn` keys nobody produces throw at `app.setup()`, not per-request. Assert that:

```ts
it('boot fails when a dependsOn key is unsatisfied', async () => {
  const NeedsLocale = defineHttpContextDecorator({
    key: 'greeting',
    dependsOn: ['locale'],
    resolve: () => 'Hello',
  })
  expect(() =>
    createTestApp({
      modules: [HomeModule],
      contributors: [NeedsLocale.registration],     // no locale producer anywhere
    }),
  ).toThrow(/MissingContributorError/)
})
```

### Service-level reads in tests (no `ctx`)

A service that calls `getRequestValue` works in tests too — `createTestApp` mounts `requestScopeMiddleware` automatically, so the ALS frame is active for every request. Assert against an endpoint that triggers the service path:

```ts
import { Service, getRequestValue } from '@forinda/kickjs'

@Service()
class GreetingService {
  greet(): string {
    const locale = getRequestValue('locale')
    return locale?.language === 'fr' ? 'Bonjour' : 'Hello'
  }
}

it('service reads the locale via getRequestValue during a request', async () => {
  const { expressApp } = createTestApp({ modules: [HomeModule] })
  const res = await supertest(expressApp)
    .get('/api/v1/greet')
    .set('Accept-Language', 'fr-CA')
    .expect(200)
  expect(res.body.greeting).toBe('Bonjour')
})
```

For unit-testing a service that calls `getRequestValue` *without* spinning up an Express stack, wrap the assertion body in `requestStore.run(...)`:

```ts
import { requestStore } from '@forinda/kickjs'

it('returns the right greeting given a locale', () => {
  requestStore.run(
    {
      requestId: 'test',
      instances: new Map(),
      values: new Map<string, unknown>([['locale', { language: 'fr', region: null }]]),
    },
    () => {
      expect(new GreetingService().greet()).toBe('Bonjour')
    },
  )
})
```

See the [`@forinda/kickjs-testing` API reference](../api/testing.md) for the full helper signatures.
