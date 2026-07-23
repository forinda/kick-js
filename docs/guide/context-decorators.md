# Context Decorators

Context decorators are a typed, ordered, declarative way to populate `ctx.set('key', value)` _before_ a controller handler runs. They replace hand-written middleware whose only job is "compute X and stash it on the request".

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

Anything you repeatedly compute from the incoming request is a candidate. The pattern is NOT multi-tenancy-specific — here are ten distinct domains where contributors remove a lot of boilerplate.

**1. Request tracing** — timestamp / trace id / span id for every handler and service on the chain.

- _Shape_: `requestStartedAt: number`, `traceId: string`
- _Why it wins_: transport-agnostic (HTTP + WS + queue + cron share the same primitive). Services read via `getRequestValue('traceId')` without a `ctx` reference.

**2. Locale / i18n negotiation** — resolve from `Accept-Language`, user prefs, cookie, in that order.

- _Shape_: `locale: { language: string; region: string | null }`
- _Why it wins_: typed once via `ContextMeta`, never re-derived. Replaced per-route (`/admin` forces `en`) without forking the middleware stack.

**3. Feature flags** — evaluate flags once, cache the result for the request's lifetime.

- _Shape_: `featureFlags: Record<string, boolean>`
- _Why it wins_: `deps: { flags: FLAG_SERVICE }` pulls the evaluator from DI — no `container.getInstance()` boilerplate. Downstream `dependsOn: ['featureFlags']` gives guaranteed-present flags.

**4. A/B test bucket assignment** — stable-hash the user into a variant, reusing feature-flag state.

- _Shape_: `abBucket: 'control' | 'variantA' | 'variantB'`
- _Why it wins_: `dependsOn` encodes "flags must resolve first" once; framework topo-sorts. Middleware order bugs (forgetting to mount B before C) become startup errors, not silent 500s.

**5. Rate-limit key derivation** — combine user id + IP + route to produce the limiter key.

- _Shape_: `rateLimitKey: string`
- _Why it wins_: contributor returns one string; downstream rate-limit middleware reads it and enforces. Separation of computation (typed, tested) from enforcement (side-effectful).

**6. Idempotency key validation** — pluck `Idempotency-Key`, reject mutations missing it.

- _Shape_: `idempotencyKey: string | null`
- _Why it wins_: `onError` captures the "missing on POST/PUT" case cleanly — return `null` or throw per your policy. Pipeline enforces the check at boot: forgetting to mount it globally is surfaced by TS if another contributor `dependsOn`s it.

**7. Geolocation from CDN headers** — parse Cloudflare / Fastly / Vercel headers once.

- _Shape_: `geo: { country | null; city | null; lat | null; lng | null }`
- _Why it wins_: adapter authors ship `@ResolveGeo` + `GeoAdapter` — adopters pick per-route opt-in OR cross-cutting activation. No "wrap the app in a context provider" boilerplate.

**8. Workspace / organisation / project scoping** — resolve the active scope from URL param or header.

- _Shape_: `workspace: { id; name; members }` (or `org`, `project`, `team`, `room` — whatever your domain calls it)
- _Why it wins_: not just a tenant loader. Any scoped app (collab tools, chat, kanban, CI) owns its scope name. Multi-level scoping (`workspace` → `project` → `task`) composes via `dependsOn`.

**9. Warmed user profile / permission set** — read once from cache, share across handler + services.

- _Shape_: `user: { id; email; roles }`, `permissions: Set<string>`
- _Why it wins_: auth middleware sets the user; a contributor warms the profile + cached permission set. Services read via `getRequestValue('user')` without threading the user through every method signature.

**10. Correlation ID for distributed tracing / saga state** — propagate an inbound `X-Correlation-ID`, or generate one.

- _Shape_: `correlationId: string`, `sagaContext: { step: number; ...}`
- _Why it wins_: contributor runs before every route AND every queue job (same registration, different transport). Downstream logs, outbound HTTP clients, and emitted events all pick up the same id.

### Why this is more flexible than middleware

Same job, different ergonomics. Each line below maps a middleware pain point to the contributor primitive that solves it.

- **Type safety** — middleware mutates `req.user` / `(req as any).tenant`, all typed `any`. Contributors expose `ctx.get('user')` / `ctx.get('tenant')` typed via `ContextMeta` augmentation.
- **Ordering** — middleware is an array in `bootstrap({ middlewares: [...] })`; order is whatever you wrote. Contributors use `dependsOn: ['x']` — topo-sorted at boot, missing deps + cycles fail startup, not per-request.
- **DI access** — middleware reaches for `Container.getInstance()` inside the body. Contributors declare `deps: { repo: TOKEN }` typed, resolved once, handed to `resolve(ctx, deps)`.
- **Testing** — middleware needs `supertest` + the whole Express stack. Contributors test via `runContributor` (from `@forinda/kickjs-testing`) — single resolver against a stub ctx.
- **Per-route override** — middleware is global: every route pays the cost, no opt-out per endpoint. Contributors have five precedence levels (method > class > module > adapter > global) — override per-route without forking the stack.
- **Transport-agnostic** — middleware is HTTP-only; WebSocket / queue / cron use different lifecycles. `defineContextDecorator` registrations reuse across every ctx the pipeline supports.
- **Plugin distribution** — middleware authors ship `app.use(myMiddleware())` and hope you call it in the right spot. Contributor authors ship `MyAdapter` (which registers via `contributors?()`) AND the raw decorator — adopters pick the ergonomic.
- **Augmentation surface** — middleware leaks via `declare global { namespace Express { interface Request { ... } } }` across every handler in the app. `ContextMeta` augmentation is typed; `defineAugmentation` advertises it in the typegen catalogue for discovery.
- **Error handling** — middleware throw → 500 unless you wrote `try/catch` around every middleware. Contributors expose `optional: true` (skip silently) + `onError` (typed fallback value).
- **Per-route opt-out** — "remove the rate-limit middleware on `/health`" forces forking the stack or path-checking inside. Mount `@SkipRateLimit` at method level — higher precedence wins, adapter's registration silently drops for that one route.

## Quickstart

Scaffold one with the CLI:

```bash
kick g contributor tenant                          # HTTP (RequestContext), key 'tenant'
kick g contributor session --type bare             # ExecutionContext (transport-agnostic)
kick g contributor tenant --params "source:string" # emits the withParams<T>() form
kick g contributor admin -m users                  # scoped inside the users module
```

`--type http` (default) types the resolver against `RequestContext`; `--type bare` against `ExecutionContext`. `--params` switches to the curried `.withParams<T>()` form with a generated params type. The scaffold also drops a `ContextMeta` augmentation stub for the key. Or write one by hand:

```ts
import { defineHttpContextDecorator, Controller, Get, type RequestContext } from '@forinda/kickjs'

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
    const locale = ctx.get('locale') // typed: { language: string; region: string | null }
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
    const tenant = ctx.require('tenant') // throws if LoadTenant didn't run
    return projectsRepo.findFor(tenant.id, ctx.params.id)
  },
})
```

The framework topologically sorts contributors at route mount time. Two failure modes:

- **Missing dependency.** A contributor declares `dependsOn: ['tenant']` but no other contributor produces `'tenant'` for the same route. The boot fails with `MissingContributorError` naming the dependent and the route.
- **Cycle.** Two contributors depend on each other (directly or transitively). Boot fails with `ContributorCycleError` reporting the cycle path.

Both errors are raised once during `app.setup()`, not per request. Bad pipelines fail fast.

::: tip `dependsOn` and `deps` are statically typed

- `dependsOn` is typed against the **union of two registries**: `keyof ContextMeta` (keys that have a value type) **and** `keyof ContextKeys` (key-only registry). Augment either and the editor surfaces a string-literal autocomplete for every known key. A typo (`dependsOn: ['tenent']`) is a TS error with "Did you mean 'tenant'?" — not a boot-time `MissingContributorError`.
- `deps` is typed as `Record<string, DepValue>` where `DepValue = InjectionToken<T> | Constructor<T>`. Passing a string literal, an array, or a plain object errors at compile time instead of failing inside `container.resolve` at boot.

Both narrow gracefully — projects without any augmentation see `dependsOn` accept plain `string[]` so first-day code keeps compiling; the narrowing kicks in as soon as the first `declare module` block lands.
:::

::: tip `ContextMeta` vs `ContextKeys`

Two augmentable registries, deliberately separate:

- **`ContextMeta`** — maps a key to its **value type**, so `ctx.get('tenant')` is typed. Augment this when downstream code reads the value.
- **`ContextKeys`** — a **key-only** registry for context keys that don't need a value type (markers, or values you only ever read with an explicit generic). The value you assign is irrelevant — `true` is conventional.

`dependsOn` accepts keys from **both**. This matters: before they were split, `dependsOn` was keyed off `ContextMeta` alone, so the moment you augmented `ContextMeta` for _some_ keys, any contributor that depended on a key you hadn't added there stopped compiling. Now adding a value type via `ContextMeta` never breaks an unrelated `dependsOn` — and you can register a dependsOn-able key without inventing a value type for it:

```ts
declare module '@forinda/kickjs' {
  interface ContextMeta {
    tenant: { id: string; name: string } // ctx.get('tenant') is typed
  }
  interface ContextKeys {
    session: true // valid in dependsOn; ctx.get('session') stays `unknown`
  }
}
```

:::

## Reading guaranteed values: `ctx.require()`

`ctx.get(key)` returns `T | undefined` for **every** key, including keys a contributor guarantees. The type system doesn't know which contributors a given route carries, so the guarantee can't be expressed in `get`'s return type.

The tempting fix is a non-null assertion — and it's a trap:

```ts
// ⚠️ compiles whether or not @OperatorPerm is applied to this route
const perm = ctx.get('operatorPerm')!
```

Drop the decorator during a refactor and nothing complains. `tsc` is satisfied, the pipeline runs, and your handler reads `undefined` where it expected a permission. On an authorization gate that fails **open**, silently.

`ctx.require(key)` is the same read with the guarantee enforced:

```ts
// ✅ throws MissingContextValueError naming the key and the route
const perm = ctx.require('operatorPerm')
```

It returns `Exclude<MetaValue<K>, undefined>` — no `!`, no `| undefined` — and throws `MissingContextValueError` when the value isn't there. The message names the key and the route, and points at the two causes: the producing contributor isn't applied to that route, or it ran and resolved to `undefined`.

**Use `require` for preconditions, `get` for optional extras:**

| Value                                            | Read with       |
| ------------------------------------------------ | --------------- |
| Permission, tenant, the route's resolved subject | `ctx.require()` |
| Anything a contributor marked `optional: true`   | `ctx.get()`     |
| Ad-hoc keys nothing is guaranteed to write       | `ctx.get()`     |

`null` counts as present — only `undefined` throws. A contributor that deliberately resolves to `null` is saying "looked, found nothing", which is a real answer.

### A dropped decorator is a compile error

When your handler is typed with a generated route type — `Ctx<KickRoutes.AuditController['audit']>` — `kick typegen` narrows `require()` to the keys it proved that route actually carries. Removing the decorator removes the key:

```ts
@LoadTenant
@OperatorPerm({ action: 'audit:read' })   // ← delete this line
@Get('/audit')
audit(ctx: Ctx<KickRoutes.AuditController['audit']>) {
  return ctx.json({ perm: ctx.require('operatorPerm') })
}
```

```text
error TS2345: Argument of type '"operatorPerm"' is not assignable to parameter of type '"tenant"'.
```

That's the refactor that used to be invisible: `ctx.get('operatorPerm')!` compiled either way, and the handler read `undefined` into an authorization check.

`ctx.get()` is deliberately **not** narrowed. Narrowing it would mean claiming a key is present, and if typegen were ever wrong about that you'd have a value the types promise and the runtime doesn't deliver — the exact failure `require()` exists to prevent. `require()` narrows in the safe direction: if typegen's view is incomplete you get a compile error, not a false guarantee.

::: tip When typegen can't prove it, it doesn't narrow

Narrowing applies only to routes whose full contributor set is provable. Typegen resolves four of the five registration sites:

| Site                              | Resolved?                                                                                                         |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Method decorator                  | ✅                                                                                                                |
| Class decorator                   | ✅                                                                                                                |
| Module `contributors()`           | ✅ — attributed to the controllers that module mounts                                                             |
| Bootstrap `contributors: [...]`   | ✅ — applies to every route, so it unions into all of them (`bootstrap()`, `createWebApp()`, `new Application()`) |
| Adapter / plugin `contributors()` | ❌ — the body ships from a package typegen can't read                                                             |

It emits no narrowing (today's behaviour) when it sees an unrecognised decorator, an unresolvable import, an ambiguous name, a registration list it can't enumerate (a spread, a helper call, a variable instead of a literal array), a controller mounted by two modules, or **any adapter or plugin** `contributors()` — that last one degrades the whole project, since the keys it adds to every route are unknowable.

If narrowing is ever wrong for a route, type the handler as plain `RequestContext` instead of `Ctx<KickRoutes…>` — that opts out entirely.

Integration tests that exercise each route are still worth having; narrowing covers the dropped-decorator case, not a contributor that throws or resolves to `undefined`.
:::

## Error handling

When a `resolve()` throws, the runner consults two flags before deciding what to do:

| `resolve()` outcome                    | `optional` | `onError` defined | Behaviour                                                               |
| -------------------------------------- | ---------- | ----------------- | ----------------------------------------------------------------------- |
| throws                                 | `true`     | —                 | skip the contributor; `ctx.get(key)` returns `undefined`                |
| throws                                 | `false`    | yes               | call `onError(err, ctx)`; returned value (if any) is stored under `key` |
| throws                                 | `false`    | no                | propagate the original error to the Express error handler               |
| `onError` throws                       | —          | —                 | propagate the _new_ error                                               |
| `onError` returns `undefined` / `void` | —          | —                 | skip; key remains unset                                                 |
| resolves                               | —          | —                 | `ctx.set(key, value)`                                                   |

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
  me(ctx: RequestContext) {
    /* ... */
  }
}

// Class-level
@LoadTenant
class C {
  /* every method on C now sees `tenant` */
}

// Module-level
class TenantsModule implements AppModule {
  contributors() {
    return [LoadTenant.registration]
  }
  routes() {
    /* ... */
  }
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

A `RequestContext` is also bound to the layer's specific `next` callback — the function you call to advance to the _next_ middleware in the chain. The contributor wrapper's `next` runs the main handler; the main handler's `next` runs the error handler. Reusing one ctx across layers would either freeze `next` to the first layer's chain (breaking error propagation) or require mutation per layer (defeating the point).

The cost is small: a `RequestContext` is one `new` allocation with three field assignments and zero hidden work. Construction is dominated by Express's own per-middleware overhead.

The cost would only matter if you wrote code that relied on object identity (`ctx.foo = X` and read it back from a downstream layer's ctx). That's the trap the [survives table](#what-survives-the-chain-and-what-doesnt) above is for — write through `ctx.set` / `ctx.get` (the ALS-backed bag), not through ctx properties, and the three-instance fact never bites.

The framework explicitly does NOT cache the ctx on `req` (e.g. `req.kickjsCtx`) because: (a) it would pollute Express's public `Request` type for non-kickjs middleware in the chain; (b) advanced adopters can layer in their own caching at the wrapper they own, but the framework shouldn't make the policy choice for them.
:::

### What survives the chain — and what doesn't

| Pattern                                                | Survives across instances? | Why                                                                                      |
| ------------------------------------------------------ | -------------------------- | ---------------------------------------------------------------------------------------- |
| `ctx.set('tenant', x)` then `ctx.get('tenant')`        | ✅ yes                     | both go through the ALS-backed `Map`                                                     |
| `ctx.req.headers['x-tenant-id']`                       | ✅ yes                     | `req` is the underlying Express request, single instance for the whole request lifecycle |
| `ctx.user`, `ctx.tenantId`, `ctx.roles` (auth getters) | ✅ yes                     | the getters consult the ALS Map first, fall back to `req.user`                           |
| `ctx.tenant = x` (direct property assignment)          | ❌ no                      | sticks to one instance only — the next stage's instance never sees it                    |
| `(ctx as any)._foo = x`                                | ❌ no                      | same — the assignment is local to one JS object                                          |
| `req.foo = x` (mutate the underlying Express request)  | ✅ yes                     | `req` is shared; this is the legacy escape hatch and not recommended                     |

### Why this matters for `onError`

The `onError` hook signature is `(err, ctx) => MaybePromise<MetaValue<K> | undefined | void>`. The runner consumes the **return value**:

```ts
const LoadTenant = defineHttpContextDecorator({
  key: 'tenant',
  onError(err, _ctx) {
    log.error(err, 'tenant load failed')
    return { id: 'unknown', name: 'Unknown' } // ← runner does ctx.set('tenant', this)
  },
  resolve: (ctx) => ({
    /* … */
  }),
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

Letting arbitrary services reach in and mutate the store from anywhere is "spooky action at a distance" — keys appear without an obvious source and tracing which service polluted what becomes a grep exercise. Services that need to publish per-request state should return the value to their caller and let _that_ layer write it via `ctx.set`. If you need a service-level write surface, expose a narrow named function (`recordTrace`, `markStartTime`) on the service that captures the side effect — not a generic write helper.
:::

### Augmenting `ContextMeta`: `declare module` vs `defineAugmentation`

Two calls, two jobs, **both needed if you want both type safety and discoverability**.

#### `declare module '@forinda/kickjs' { interface ContextMeta { ... } }`

- **What it does** — tells **TypeScript** that `ctx.get('tenant')` returns your shape. Resolved at compile time by `tsc` / your IDE.
- **What it doesn't do** — doesn't show up anywhere else in the project. Other devs reading the codebase have to grep for `declare module` to discover what keys are augmented.

#### `defineAugmentation('ContextMeta', { description, example })`

- **What it does** — tells **`kick typegen`** to list the interface in `.kickjs/types/augmentations.d.ts` so every augmentable surface is discoverable from one place. Runtime + type-level no-op.
- **What it doesn't do** — doesn't actually augment anything. Skipping the `declare module` block leaves `ctx.get('tenant')` as `unknown`.

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
  resolve: (ctx) => ({
    /* fetch and return the tenant */
  }),
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

If you need to _prove_ which one fired (debugging, smoke tests), have the resolvers produce distinguishable values:

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

Five registration sites, ranked from most-specific to most-general (which is also the precedence order — narrower wins).

- **`@LoadX` on a method** — one specific route needs an override or extra contributor. Inline; easy to spot when reading the handler.
- **`@LoadX` on a class** — every route in this controller needs the same value. Avoids decorating each method individually.
- **`AppModule.contributors?()`** — every route the module mounts. Keeps the controller files clean; lives next to module wiring.
- **`AppAdapter.contributors?()` / `KickPlugin.contributors?()`** — cross-cutting defaults shipped by a reusable package. Apply everywhere, overridable by anything narrower.
- **`bootstrap({ contributors: [...] })`** — app-wide defaults you wrote in the entry file. Lowest precedence — easy to override by accident; prefer adapter-level for shared concerns.

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
  interface ContextMeta {
    requestStartedAt: number
  }
}

const TraceStart = defineContextDecorator({
  key: 'requestStartedAt',
  resolve: () => Date.now(),
})

bootstrap({
  modules,
  contributors: [TraceStart.registration], // global — every route, every transport
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

interface FlagService {
  evaluate(userId: string | undefined): Promise<Record<string, boolean>>
}
export const FLAG_SERVICE = createToken<FlagService>('app/flags/service')

declare module '@forinda/kickjs' {
  interface ContextMeta {
    featureFlags: Record<string, boolean>
  }
}

const LoadFeatureFlags = defineHttpContextDecorator({
  key: 'featureFlags',
  deps: { flags: FLAG_SERVICE },
  resolve: async (ctx, { flags }) => {
    const userId = ctx.req.headers['x-user-id'] as string | undefined
    return flags.evaluate(userId)
  },
  onError: () => ({}), // fallback: no flags enabled if the service blows up
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
  interface ContextMeta {
    abBucket: 'control' | 'variantA' | 'variantB'
  }
}

const AssignAbBucket = defineHttpContextDecorator({
  key: 'abBucket',
  dependsOn: ['featureFlags'], // typed against ContextMeta — typos are TS errors
  resolve: (ctx) => {
    const flags = ctx.require('featureFlags') // guaranteed by dependsOn
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
  interface ContextMeta {
    idempotencyKey: string | null
  }
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

The pattern most reusable packages will follow — expose both the registration (for `contributors?()` hooks) _and_ a decorator alias (for per-route opt-in). Adopters pick the ergonomic that fits their call site:

```ts
// packages/geo/src/index.ts
import { defineAdapter, defineAugmentation, defineHttpContextDecorator } from '@forinda/kickjs'

declare module '@forinda/kickjs' {
  interface ContextMeta {
    geo: {
      country: string | null
      city: string | null
      latitude: number | null
      longitude: number | null
    }
  }
}

defineAugmentation('ContextMeta', {
  description:
    'Geolocation resolved from CDN headers (Cloudflare / Fastly / Vercel) by GeoAdapter.',
  example: `{ geo: { country: string | null; city: string | null; latitude: number | null; longitude: number | null } }`,
})

const ResolveGeo = defineHttpContextDecorator({
  key: 'geo',
  resolve: (ctx) => ({
    country: (ctx.req.headers['cf-ipcountry'] as string | undefined) ?? null,
    city: (ctx.req.headers['cf-ipcity'] as string | undefined) ?? null,
    latitude: parseOrNull(ctx.req.headers['cf-iplatitude']),
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
  ctx.json({ country: ctx.require('geo').country })
}
```

### 9. Reading contributor output from a service that has no `ctx`

Any service can read what contributors wrote — no `ctx` parameter needed — via `getRequestValue` (typed lookup) and `getRequestStore` (full record including `requestId`):

```ts
import { Service, getRequestValue, getRequestStore } from '@forinda/kickjs'

@Service()
class AuditService {
  log(action: string) {
    const locale = getRequestValue('locale') // typed via ContextMeta
    const geo = getRequestValue('geo')
    const bucket = getRequestValue('abBucket')

    db.audit.insert({
      action,
      locale: locale?.language,
      geoCountry: geo?.country,
      bucket,
      requestId: getRequestStore().requestId,
    })
  }
}
```

`getRequestValue(key)` returns `MetaValue<K> | undefined` — null-tolerant, so service code that runs in both request and non-request paths doesn't throw. `getRequestStore()` throws if there's no active frame; use it when you need `requestId` and the call site is guaranteed to be inside a request.

Writes still flow through `ctx.set` (or a contributor's return value) — see the warning in [Reading the same value from a service](#reading-the-same-value-from-a-service-no-ctx-in-scope) for why services don't get a service-level write helper.

### 10. Tenant-scoped database — controller injects, service reads via ALS

A real SaaS pattern: each tenant has their own Postgres database, and every service / use-case in the request flow needs to talk to **that tenant's** DB — not the master / control-plane DB. The contributor pipeline composes this in two stages: identity first (`@LoadTenant`), then the per-tenant DB client (`@LoadTenantDb`, depends on `tenant`).

The handler doesn't need to thread the DB anywhere — services read it via `getRequestValue('tenantDb')`.

#### Augment ContextMeta

```ts
// src/types/context.ts
import type { KickDbClient } from '@forinda/kickjs-db'

declare module '@forinda/kickjs' {
  interface ContextMeta {
    tenant: { id: string; name: string; dbUrl: string }
    tenantDb: KickDbClient
  }
}

import { defineAugmentation } from '@forinda/kickjs'

defineAugmentation('ContextMeta', {
  description: 'Per-request tenant identity + tenant-scoped Postgres client.',
  example: `ctx.get('tenantDb')`,
})
```

#### Tenant registry + connection pool — DI services

```ts
// src/tenant/tenant-registry.service.ts
import { Service, createToken } from '@forinda/kickjs'
import { sql } from '@forinda/kickjs-db'
import type { KickDbClient } from '@forinda/kickjs-db'

export interface TenantRecord {
  id: string
  name: string
  dbUrl: string
}

export const TENANT_REGISTRY = createToken<TenantRegistryService>('app/tenant/registry')

@Service()
export class TenantRegistryService {
  // Master DB — the "control plane" that knows where each tenant lives.
  constructor(private readonly masterDb: KickDbClient) {}

  async findById(id: string): Promise<TenantRecord | null> {
    const row = await this.masterDb
      .selectFrom('tenants')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst()
    return row ?? null
  }
}
```

```ts
// src/tenant/tenant-db-pool.service.ts
import { Service, createToken } from '@forinda/kickjs'
import { createDbClient, pgDialect, type KickDbClient } from '@forinda/kickjs-db'
import { Pool } from 'pg'

export const TENANT_DB_POOL = createToken<TenantDbPoolService>('app/tenant/db-pool')

@Service()
export class TenantDbPoolService {
  // One KickDbClient per tenant. Created lazily on first request,
  // cached for the life of the process. In production you'd cap the
  // map + LRU-evict idle clients; this is the minimal shape.
  private readonly clients = new Map<string, KickDbClient>()

  for(tenant: { id: string; dbUrl: string }): KickDbClient {
    const existing = this.clients.get(tenant.id)
    if (existing) return existing
    const client = createDbClient({
      dialect: pgDialect({ pool: new Pool({ connectionString: tenant.dbUrl }) }),
    })
    this.clients.set(tenant.id, client)
    return client
  }
}
```

#### Two parameterised contributors

```ts
// src/tenant/contributors.ts
import { defineHttpContextDecorator, type RequestContext } from '@forinda/kickjs'
import { TENANT_REGISTRY } from './tenant-registry.service'
import { TENANT_DB_POOL } from './tenant-db-pool.service'

// 1. Tenant identity — parameterised by source so /admin can use a
// different header than the public-facing routes.
type LoadTenantParams = { source: 'header' | 'subdomain'; headerName?: string }

export const LoadTenant = defineHttpContextDecorator.withParams<LoadTenantParams>()({
  key: 'tenant',
  deps: { registry: TENANT_REGISTRY },
  paramDefaults: { source: 'header', headerName: 'x-tenant-id' },
  resolve: async (ctx, { registry }, params) => {
    const id =
      params.source === 'header'
        ? (ctx.req.headers[params.headerName ?? 'x-tenant-id'] as string)
        : ctx.req.hostname.split('.')[0]
    const tenant = await registry.findById(id)
    if (!tenant) throw new Error(`Unknown tenant: ${id}`)
    return tenant
  },
})

// 2. Tenant-scoped DB client. dependsOn: ['tenant'] guarantees the
// identity contributor has already resolved when this one runs.
type LoadTenantDbParams = { pool: 'primary' | 'replica' }

export const LoadTenantDb = defineHttpContextDecorator.withParams<LoadTenantDbParams>()({
  key: 'tenantDb',
  deps: { dbPool: TENANT_DB_POOL },
  dependsOn: ['tenant'],
  paramDefaults: { pool: 'primary' },
  resolve: (ctx, { dbPool }, _params) => {
    // `params.pool === 'replica'` would route to a read-replica DSN
    // here — wired the same way; omitted for brevity.
    const tenant = ctx.require('tenant')
    return dbPool.for(tenant)
  },
})
```

#### Controller stacks both decorators

```ts
// src/orders/orders.controller.ts
import { Controller, Get, Post, type RequestContext } from '@forinda/kickjs'
import { Autowired } from '@forinda/kickjs'
import { LoadTenant, LoadTenantDb } from '../tenant/contributors'
import { OrdersUseCase } from './orders.use-case'

@LoadTenant
@LoadTenantDb
@Controller()
export class OrdersController {
  @Autowired() private readonly orders!: OrdersUseCase

  @Get('/orders')
  list(ctx: RequestContext) {
    // The use case has no idea about tenants — it just calls the
    // service, which reads the tenant DB via ALS.
    return this.orders.list()
  }

  @Post('/orders')
  create(ctx: RequestContext) {
    return this.orders.create(ctx.body as { sku: string; qty: number })
  }
}
```

`@LoadTenant` runs first (`dependsOn` on `LoadTenantDb` enforces it). Both decorators are applied **at the class level** so every method on the controller inherits them — no per-method repetition.

For an admin-facing controller that expects a different header, override at the class level:

```ts
@LoadTenant({ source: 'header', headerName: 'x-admin-tenant-id' })
@LoadTenantDb
@Controller()
class AdminOrdersController {
  // …
}
```

#### Service / use-case reads the tenant DB without `ctx`

```ts
// src/orders/orders.service.ts
import { Service, getRequestValue } from '@forinda/kickjs'

@Service()
export class OrdersService {
  async list() {
    // `tenantDb` typed via ContextMeta. No `ctx` parameter needed —
    // we read from AsyncLocalStorage under the hood.
    const db = getRequestValue('tenantDb')
    if (!db) throw new Error('OrdersService called outside a tenant-scoped request')
    return db.selectFrom('orders').selectAll().execute()
  }

  async create(input: { sku: string; qty: number }) {
    const db = getRequestValue('tenantDb')!
    const tenant = getRequestValue('tenant')!
    return db
      .insertInto('orders')
      .values({ ...input, tenantId: tenant.id, createdAt: new Date() })
      .returningAll()
      .executeTakeFirstOrThrow()
  }
}
```

```ts
// src/orders/orders.use-case.ts
import { Service, Autowired } from '@forinda/kickjs'
import { OrdersService } from './orders.service'

@Service()
export class OrdersUseCase {
  @Autowired() private readonly orders!: OrdersService

  list() {
    return this.orders.list()
  }

  create(input: { sku: string; qty: number }) {
    // Validation, business rules, etc — domain logic stays free of
    // tenant plumbing because the service reads `tenantDb` from ALS.
    if (input.qty <= 0) throw new Error('qty must be positive')
    return this.orders.create(input)
  }
}
```

#### What you get

- **Database isolation per tenant** — every query goes to the right DB without the controller, use case, or service threading anything. The contributor pipeline + ALS handles propagation.
- **Override per route or controller** — `@LoadTenant({ source: 'subdomain' })` on one class, `@LoadTenant({ source: 'header' })` on another. Same `LoadTenant` definition, same DI deps, same topo position.
- **Read replicas via param** — `@LoadTenantDb({ pool: 'replica' })` on read-only routes (extend the resolver as shown).
- **Testable in isolation** — `runContributor(LoadTenantDb, { ctxSeed: { tenant: fakeTenant }, deps: { dbPool: fakePool } })` exercises the resolver with no Express stack.

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

- **Unit — one contributor in isolation.** Helper: `runContributor(decorator, opts)`. Use when asserting the resolver's pure logic (input → output), mocking deps, or pre-seeding `dependsOn` keys.
- **Integration — full pipeline + handler.** Helper: `createTestApp({ modules })` + `supertest`. Use when asserting the handler actually sees the contributor's value, verifying multi-contributor topo-order, or testing route-level overrides.

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
  interface ContextMeta {
    featureFlags: Record<string, boolean>
  }
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
    const { language } = ctx.require('locale') // guaranteed by dependsOn at runtime
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
  resolve: () => {
    throw new Error('lookup failed')
  },
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
    resolve: () => {
      throw new Error('nope')
    },
  })
  const pipeline = buildPipeline([{ source: 'method', registration: Flaky.registration }])
  const container = Container.create()
  const meta = new Map<string, unknown>()
  const ctx = {
    requestId: 'r',
    get: (k: string) => meta.get(k),
    set: (k: string, v: unknown) => void meta.set(k, v),
  } as never

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
import {
  defineHttpContextDecorator,
  Controller,
  Get,
  type RequestContext,
  buildRoutes,
} from '@forinda/kickjs'

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

@Controller()
class HomeController {
  @ResolveLocale
  @Get('/')
  home(ctx: RequestContext) {
    ctx.json({ locale: ctx.get('locale') })
  }
}

class HomeModule {
  routes() {
    return { path: '/', router: buildRoutes(HomeController), controller: HomeController }
  }
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
  resolve: () => ({ language: 'en', region: null }), // forced default
})

@Controller()
class StaticController {
  @StubLocale // method wins over the global ResolveLocale
  @Get('/static')
  page(ctx: RequestContext) {
    ctx.json({ locale: ctx.get('locale') })
  }
}

it('method-level override beats the global contributor', async () => {
  const { expressApp } = createTestApp({
    modules: [StaticModule],
    contributors: [ResolveLocale.registration], // global
  })
  const res = await supertest(expressApp)
    .get('/api/v1/static')
    .set('Accept-Language', 'fr-CA') // would be `fr` under the global
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
      contributors: [NeedsLocale.registration], // no locale producer anywhere
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

For unit-testing a service that calls `getRequestValue` _without_ spinning up an Express stack, wrap the assertion body in `requestStore.run(...)`:

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

## Parameterised contributors

Decorators ship with one definition; adopters apply them with **per-call params**. The same `defineContextDecorator(...)` value can serve many call sites that differ only in configuration — header name, policy class, audit-log action, rate-limit window, anything.

Pass `paramDefaults` and a third `params` argument on `resolve` / `onError`.

### Recommended: `.withParams<P>()` curried form

TypeScript generics are positional, so once you want to specify the per-call params shape `P` on `defineContextDecorator<K, D, P, Ctx>(spec)`, you also have to spell `K` and `D` — which **loses the automatic `deps` inference** that drives the `(ctx, deps, params) => …` resolver signature.

`defineContextDecorator.withParams<P>()(spec)` is the curried entry point that fixes this. You spell only `P`; `K`, `D`, and `Ctx` infer from the spec value, so `deps.<name>` ends up fully typed in the resolver without any annotation.

For HTTP-flavoured contributors (the common case), reach for `defineHttpContextDecorator.withParams<P>()(spec)` — `Ctx` is locked to `RequestContext`, so `ctx.req`, `ctx.req.headers`, `ctx.req.hostname`, etc. are typed without a cast:

```ts
import { defineHttpContextDecorator } from '@forinda/kickjs'
import { TENANT_REGISTRY } from './tenant-registry.service'

type LoadTenantParams = {
  source: 'header' | 'subdomain' | 'jwt'
  headerName?: string
}

export const LoadTenant = defineHttpContextDecorator.withParams<LoadTenantParams>()({
  key: 'tenant', // K inferred as 'tenant' literal
  deps: { registry: TENANT_REGISTRY }, // D inferred → deps.registry typed
  paramDefaults: { source: 'header', headerName: 'x-tenant-id' },
  resolve: (ctx, { registry }, params) => {
    if (params.source === 'header') {
      return registry.findById(ctx.req.headers[params.headerName ?? 'x-tenant-id'] as string)
    }
    if (params.source === 'subdomain') {
      return registry.findById(ctx.req.hostname.split('.')[0])
    }
    return registry.findById(ctx.req.user?.tenantId ?? '')
  },
})
```

Use the core `defineContextDecorator.withParams<P>()(spec)` form when authoring contributors for non-HTTP transports (WebSocket, queue, cron) or when sharing one definition across transports — the resolver then sticks to the `ExecutionContext` surface (`ctx.get`, `ctx.set`, `ctx.requestId`).

### Required params — don't invent a default

`paramDefaults` is optional per field. Any field of `P` that is **required** and has **no** entry in `paramDefaults` must be supplied at every call site, and the compiler enforces it:

```ts
type PermParams = { action: string; scope?: string }

const OperatorPerm = defineHttpContextDecorator.withParams<PermParams>()({
  key: 'operatorPerm',
  // no paramDefaults.action — every route must name its own action
  resolve: (ctx, _deps, { action }) => checkPermission(ctx, action),
})

@Controller()
class AuditController {
  @OperatorPerm // ✗ TS error — `action` missing
  @Get('/a')
  a(ctx: RequestContext) {}

  @OperatorPerm({}) // ✗ TS error — `action` missing
  @Get('/b')
  b(ctx: RequestContext) {}

  @OperatorPerm({ action: 'audit:read' }) // ✓
  @Get('/c')
  c(ctx: RequestContext) {}
}
```

For such a decorator the bare `@Foo` form, the zero-arg `@Foo()` form, and the `.registration` accessor **do not exist** — none of them can supply the value. Use `Foo.with({ action: '…' }).registration` at module / adapter / bootstrap registration sites.

This exists so you never have to invent a placeholder default just to satisfy the type. A default like `action: 'settings:read'` on a permission contributor every call site overrides is worse than no default: forget the argument on one route and it silently gates on the placeholder instead of failing to compile.

Give a field a `paramDefaults` entry **only when the default is genuinely correct for an undecorated route** — `headerName: 'x-tenant-id'` yes, a permission string almost never.

#### Runtime enforcement for JS call sites

The compile-time check covers TypeScript. For plain-JS adopters, `as any` escapes, and params assembled dynamically, add `requiredParams`:

```ts
const OperatorPerm = defineHttpContextDecorator.withParams<PermParams>()({
  key: 'operatorPerm',
  requiredParams: ['action'],
  resolve: (ctx, _deps, { action }) => checkPermission(ctx, action),
})
```

A missing field then throws `TypeError` at the point of use — decoration time for `@Foo`, call time for `@Foo({...})` and `.with({...})` — naming the decorator and the field. Partial coverage is fine: list only the fields whose absence is a correctness bug.

### Positional form (no params)

For contributors with **no per-call params**, the positional form is shorter — every generic infers, no curried call needed:

```ts
import { defineContextDecorator } from '@forinda/kickjs'

type LoadTenantParams = {
  source: 'header' | 'subdomain' | 'jwt'
  headerName?: string
}

export const LoadTenant = defineContextDecorator<'tenant', Record<string, never>, LoadTenantParams>(
  {
    key: 'tenant',
    paramDefaults: { source: 'header', headerName: 'x-tenant-id' },
    resolve: (ctx, _deps, params) => {
      if (params.source === 'header') {
        return ctx.req.headers[params.headerName ?? 'x-tenant-id'] ?? null
      }
      if (params.source === 'subdomain') {
        return ctx.req.hostname.split('.')[0]
      }
      // 'jwt' — read from upstream auth contributor.
      return ctx.req.user?.tenantId ?? null
    },
  },
)
```

The positional form **also accepts `paramDefaults` + a third `params` argument** — the only cost is the K/D generics you have to spell. Reach for `.withParams<P>()` the moment `D` is non-empty.

### Three call shapes

```ts
// 1. Zero-arg — applies paramDefaults.
@LoadTenant
@Get('/me')
me(ctx: RequestContext) {}

// 2. Factory call — merges call-site params over paramDefaults.
@LoadTenant({ source: 'subdomain' })
@Get('/orgs/:slug')
public(ctx: RequestContext) {}

// 3. Distinct params per method on the same controller.
@Controller()
class AdminCtrl {
  @LoadTenant({ source: 'header', headerName: 'x-org-id' })
  @Patch('/orgs/:id')
  update(ctx: RequestContext) {}

  @LoadTenant({ source: 'jwt' })
  @Get('/me')
  me(ctx: RequestContext) {}
}
```

Each call site produces an independent registration — params are baked into the closure the runner sees. Topo-sort and the contributor pipeline don't change; the runner can't tell parameterised from zero-arg.

### Non-decorator registration sites — `LoadTenant.with(params)`

Module / adapter / plugin / bootstrap hooks already accept `LoadTenant.registration` (no params). When the registration site **does** want to override params, use `.with()`:

```ts
import { definePlugin } from '@forinda/kickjs'
import { LoadTenant } from './tenant'

export const TenantPlugin = definePlugin({
  name: 'tenant',
  contributors: () => [
    // Project-wide subdomain rule — every controller gets it unless
    // a method-level decorator overrides.
    LoadTenant.with({ source: 'subdomain' }).registration,
  ],
})
```

`LoadTenant.registration` (no `.with()`) keeps working — behaviourally equivalent to `.with({}).registration`, which yields the `paramDefaults` registration. Note that `.with(...)` constructs a fresh frozen registration on each call, so the two are not reference-equal — only behaviourally identical.

### Function-valued params

Params are **plain values** with no shape constraint — including functions and closures. Useful for "compute this from `ctx`" cases (rate-limit key, cache key, A/B variant assigner):

```ts
import { defineHttpContextDecorator } from '@forinda/kickjs'

type RateLimitParams = {
  window: string
  max: number
  keyOf: (ctx: RequestContext) => string
}

export const RateLimited = defineHttpContextDecorator.withParams<RateLimitParams>()({
  key: 'rate-limit',
  deps: { limiter: RATE_LIMITER },
  paramDefaults: {
    window: '1m',
    max: 60,
    keyOf: (ctx) => ctx.req.ip,
  },
  resolve: (ctx, { limiter }, params) => limiter.check(params.keyOf(ctx), params),
})

// Use site — derive the key from a custom field per route.
@RateLimited({
  window: '1m',
  max: 100,
  keyOf: (ctx) => ctx.user?.id ?? ctx.req.ip,
})
@Get('/api/expensive')
expensive(ctx: RequestContext) {}
```

Function params are first-class — they capture surrounding scope just like any other closure. Validation is the adopter's choice: framework decorators stay validator-agnostic, so projects can plug Zod / Valibot / hand-rolled checks (or skip validation) on a per-decorator basis.

### Narrowing literal-union params

Param literal unions (`'header' | 'subdomain' | 'jwt'`) are **wide** inside `resolve()` — TypeScript doesn't propagate the call-site literal back into the resolver closure. Branch via `if`:

```ts
resolve: (ctx, _deps, params) => {
  if (params.source === 'header') {
    // params.source narrowed to 'header'
    return ctx.req.headers[params.headerName ?? 'x-tenant-id']
  }
  if (params.source === 'subdomain') {
    return ctx.req.hostname.split('.')[0]
  }
  // 'jwt'
  return ctx.req.user?.tenantId ?? null
}
```

This matches how `switch (request.method)` narrows in any HTTP handler — the convention is `if`, not generic-per-call narrowing.

### Working example

The full end-to-end recipe — definition + four call shapes + assertions through `runContributors` — lives at [`packages/kickjs/__tests__/parameterised-contributors.example.test.ts`](https://github.com/forinda/kick-js/blob/main/packages/kickjs/__tests__/parameterised-contributors.example.test.ts). Copy it into a project as the canonical starting point.

### Ten use cases — old approach vs parameterised contributors

Same primitive, ten domains. Each entry shows the **old approach** (forking the decorator / hardcoded middleware / per-route closure) and the **new approach** (one parameterised decorator, varied per call site).

**1. Tenant resolution**

- _Old_: fork `LoadTenant` 3× (`LoadTenantFromHeader`, `LoadTenantFromSubdomain`, `LoadTenantFromJWT`) + import the right one per controller.
- _New_: one `LoadTenant`; per-route call site picks `source: 'header' | 'subdomain' | 'jwt'`.

**2. Custom auth policy**

- _Old_: subclass `@RequirePermission` with a different policy class baked in; copy 30 lines of boilerplate.
- _New_: `@RequirePermission({ policy: AdminPolicy })` — adopter passes their policy class as a param.

**3. Permission gate**

- _Old_: hardcoded permission strings inside each contributor (`@RequireUsersWrite`, `@RequireBillingAdmin`, …).
- _New_: `@RequirePermission({ permission: 'users:write', scope: 'org' })` — one decorator, fine-grained per route.

**4. Rate-limit override**

- _Old_: per-route Express middleware with `rateLimit({ window, max, key })` inlined; lost type safety + DI.
- _New_: `@RateLimited({ window: '1m', max: 100, keyOf: (ctx) => ctx.user?.id ?? ctx.req.ip })`. Typed, DI-resolved limiter.

**5. Feature flag gate**

- _Old_: two middlewares (`requireBetaSearch`, `requireExperimentalCheckout`) + a third (`requireFlag('arbitrary')`) for cases the first two missed.
- _New_: `@RequireFeature({ flag: 'beta-search', fallback: 'reject' })` — one decorator, any flag, deterministic fallback.

**6. Body validation**

- _Old_: a `validate(schema)` middleware called per route with the schema closure-captured.
- _New_: `@ValidateBody({ schema: createUserSchema })` — adopter chooses schema lib (Zod / Valibot / plain function).

**7. Audit log**

- _Old_: manually call `auditService.log(action, ctx)` at the top of each handler.
- _New_: `@AuditLog({ action: 'user.update', captureFields: ['id', 'email'] })` — declarative, automatic.

**8. Locale resolution**

- _Old_: two locale middlewares (`localeFromHeader`, `localeFromCookie`) + an `if (req.headers['x-prefer-cookie'])` shim.
- _New_: `@LoadLocale({ source: 'header' | 'cookie', fallback: 'en-US' })`.

**9. A/B variant**

- _Old_: inline experiment evaluation in every controller method that branches on variant.
- _New_: `@LoadVariant({ experiment: 'checkout-flow', fallback: 'control' })` — pipeline writes `ctx.set('variant', ...)`.

**10. Webhook signatures**

- _Old_: provider-specific middleware per integration (`stripeSignature`, `githubSignature`, `slackSignature`).
- _New_: `@VerifySignature({ secret: STRIPE_SECRET, header: 'stripe-signature', algorithm: 'sha256' })` — same decorator, three call sites.

Below: the worked code for cases 1, 2, 4, 6, and 10 — covering both **decorator** form and **non-decorator registration** form (`.with()`).

#### 1. Tenant resolution — header / subdomain / JWT

**Old:**

```ts
// One decorator per source — adopter imports the right one per route.
const LoadTenantFromHeader = defineContextDecorator({
  key: 'tenant',
  resolve: (ctx) => repo.findById(ctx.req.headers['x-tenant-id'] as string),
})
const LoadTenantFromSubdomain = defineContextDecorator({
  key: 'tenant',
  resolve: (ctx) => repo.findBySubdomain(ctx.req.hostname.split('.')[0]),
})
// … and a third for JWT.
```

**New:**

```ts
type LoadTenantParams = { source: 'header' | 'subdomain' | 'jwt'; headerName?: string }

const LoadTenant = defineHttpContextDecorator.withParams<LoadTenantParams>()({
  key: 'tenant',
  deps: { repo: TENANT_REPO },
  paramDefaults: { source: 'header', headerName: 'x-tenant-id' },
  resolve: (ctx, { repo }, params) => {
    if (params.source === 'header') return repo.findById(ctx.req.headers[params.headerName!])
    if (params.source === 'subdomain') return repo.findBySubdomain(ctx.req.hostname.split('.')[0])
    return repo.findById(ctx.req.user!.tenantId)
  },
})

@LoadTenant({ source: 'subdomain' })
@Get('/orgs/:slug') public(ctx) {}

@LoadTenant({ source: 'header', headerName: 'x-org-id' })
@Patch('/admin/orgs/:slug') admin(ctx) {}
```

#### 2. Custom auth policy — adopter plugs their own policy class

**Old:**

```ts
// Adopter forks the framework decorator — copies the resolve body, swaps the policy import.
const RequireAdminPolicy = defineContextDecorator({
  key: 'authzCheck',
  resolve: (ctx) => new AdminPolicy().check(ctx.user, ctx.req),
})
const RequireBillingPolicy = defineContextDecorator({
  key: 'authzCheck',
  resolve: (ctx) => new BillingPolicy().check(ctx.user, ctx.req),
})
```

**New:**

```ts
interface Policy {
  check(user: User, req: Request): MaybePromise<boolean>
}

const RequirePolicy = defineHttpContextDecorator.withParams<{ policy: new () => Policy }>()({
  key: 'authzCheck',
  paramDefaults: { policy: AlwaysAllowPolicy },
  resolve: async (ctx, _deps, params) => {
    const result = await new params.policy().check(ctx.user, ctx.req)
    if (!result) throw new ForbiddenError()
    return true
  },
})

@RequirePolicy({ policy: AdminPolicy })
@Get('/admin') adminPanel(ctx) {}

@RequirePolicy({ policy: BillingPolicy })
@Get('/billing') billing(ctx) {}
```

The auth package's deprecation roadmap rests on this exact shape — adopters compose their own policy chain instead of inheriting framework primitives.

#### 4. Rate-limit override — function-valued params

**Old:**

```ts
// Inline middleware closure per route — no type safety, DI is awkward.
import rateLimit from 'express-rate-limit'

@Get('/api/expensive')
@Middleware(rateLimit({ windowMs: 60_000, max: 100, keyGenerator: (req) => req.user?.id ?? req.ip }))
expensive(ctx) {}
```

**New:**

```ts
type RateLimitParams = {
  window: string
  max: number
  keyOf: (ctx: RequestContext) => string
}

const RateLimited = defineHttpContextDecorator.withParams<RateLimitParams>()({
  key: 'rate-limit',
  deps: { limiter: RATE_LIMITER },
  paramDefaults: { window: '1m', max: 60, keyOf: (ctx) => ctx.req.ip },
  resolve: (ctx, { limiter }, params) => limiter.check(params.keyOf(ctx), params),
})

@RateLimited({ window: '1m', max: 100, keyOf: (ctx) => ctx.user?.id ?? ctx.req.ip })
@Get('/api/expensive') expensive(ctx) {}
```

The function-valued `keyOf` param is a closure — captures surrounding scope at the call site, not at decorator-definition time. The framework doesn't type-narrow this for you; pick a key strategy per route.

#### 6. Body validation — schema-library agnostic

**Old:**

```ts
// Adopter writes a Zod-specific decorator, then a Valibot-specific one if they switch libraries.
const ValidateBodyZod = (schema: ZodSchema) =>
  defineContextDecorator({
    key: 'validatedBody',
    resolve: (ctx) => schema.parse(ctx.body),
  })

@ValidateBodyZod(CreateUserSchema)
@Post('/users') create(ctx) {}
```

The closure-returning-decorator pattern works but means every call site builds its own decorator value — expensive at module-load time + opaque to DevTools.

**New:**

```ts
type Validator<T> = { parse(value: unknown): T }
type ValidateBodyParams = { schema: Validator<unknown>; on?: 'throw' | 'attach-issues' }

const ValidateBody = defineHttpContextDecorator.withParams<ValidateBodyParams>()({
  key: 'validatedBody',
  paramDefaults: { schema: { parse: (v) => v }, on: 'throw' },
  resolve: (ctx, _deps, params) => {
    try {
      return params.schema.parse(ctx.body)
    } catch (err) {
      if (params.on === 'attach-issues') {
        ctx.set('validationIssues' as never, err as never)
        return ctx.body
      }
      throw err
    }
  },
})

@ValidateBody({ schema: CreateUserSchema })
@Post('/users') create(ctx) {}

@ValidateBody({ schema: UpdateUserSchema, on: 'attach-issues' })
@Patch('/users/:id') update(ctx) {}
```

Adopter brings any validator that satisfies `Validator<T>` — Zod / Valibot / Yup / hand-rolled.

#### 10. Webhook signature verification — per-provider, same decorator

**Old:**

```ts
// One middleware per provider, cargo-culted across the codebase.
const stripeSignatureMiddleware = (req, res, next) => {
  /* sha256, stripe header */
}
const githubSignatureMiddleware = (req, res, next) => {
  /* sha1, github header */
}
const slackSignatureMiddleware = (req, res, next) => {
  /* sha256, slack header */
}
```

**New:**

```ts
type VerifyParams = {
  secret: string
  header: string
  algorithm: 'sha256' | 'sha1'
}

const VerifySignature = defineHttpContextDecorator.withParams<VerifyParams>()({
  key: 'verifiedWebhook',
  paramDefaults: { secret: '', header: 'x-signature', algorithm: 'sha256' },
  resolve: (ctx, _deps, params) => {
    const provided = ctx.req.headers[params.header]
    const expected = createHmac(params.algorithm, params.secret).update(ctx.rawBody).digest('hex')
    if (provided !== expected) throw new ForbiddenError(`Invalid ${params.header}`)
    return true
  },
})

@VerifySignature({ secret: STRIPE_SECRET, header: 'stripe-signature' })
@Post('/webhooks/stripe') stripe(ctx) {}

@VerifySignature({ secret: GITHUB_SECRET, header: 'x-hub-signature', algorithm: 'sha1' })
@Post('/webhooks/github') github(ctx) {}

@VerifySignature({ secret: SLACK_SECRET, header: 'x-slack-signature' })
@Post('/webhooks/slack') slack(ctx) {}
```

#### Non-decorator form — `.with()` for plugin / module / bootstrap registration

Every example above can register the same parameterised contributor at the **plugin / module / bootstrap** level instead of (or in addition to) the controller level. Use `.with(params).registration`:

```ts
import { definePlugin } from '@forinda/kickjs'

export const TenantPlugin = definePlugin({
  name: 'tenant',
  contributors: () => [
    // Project-wide subdomain rule; method-level decorators can still override.
    LoadTenant.with({ source: 'subdomain' }).registration,
  ],
})

// Or at bootstrap:
bootstrap({
  modules: [TenantModule],
  contributors: [
    LoadTenant.with({ source: 'header', headerName: 'x-org-id' }).registration,
    RateLimited.with({ window: '1m', max: 1000, keyOf: (ctx) => ctx.req.ip }).registration,
  ],
})
```

The same parameterised decorator drives both styles — controller-level via `@Foo({...})`, framework-level via `Foo.with({...}).registration`. Nothing about the runtime pipeline knows the difference.
