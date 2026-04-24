# Context Decorators

Context decorators are a typed, ordered, declarative way to populate `ctx.set('key', value)` *before* a controller handler runs. They replace hand-written middleware whose only job is "compute X and stash it on the request".

```ts
@LoadTenant
@LoadProject  // depends on 'tenant' — runs after LoadTenant automatically
@Get('/projects/:id')
getProject(ctx: RequestContext) {
  ctx.get('tenant')   // typed via ContextMeta, guaranteed present
  ctx.get('project')  // typed via ContextMeta, guaranteed present
}
```

Compared to writing two custom middlewares for the same job, you get:

- **Type safety** — `ctx.get('tenant')` returns the type you declared in `ContextMeta`, not `any`.
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

## Quickstart

```ts
import {
  defineHttpContextDecorator,
  Controller,
  Get,
  type RequestContext,
} from '@forinda/kickjs'

// 1. Declare the value's type via ContextMeta augmentation.
//    This is what TypeScript reads to type `ctx.get('tenant')`.
declare module '@forinda/kickjs' {
  interface ContextMeta {
    tenant: { id: string; name: string }
  }
}

// 2. Define the decorator with a resolver.
//    `defineHttpContextDecorator` pre-binds `Ctx` to `RequestContext` so
//    `ctx.req`, `ctx.headers`, `ctx.params`, etc. are typed in the resolver.
const LoadTenant = defineHttpContextDecorator({
  key: 'tenant',
  resolve: (ctx) => ({
    id: ctx.req.headers['x-tenant-id'] as string,
    name: 'Acme',
  }),
})

// 3. Apply it on a controller method (or class)
@Controller()
class MeController {
  @LoadTenant
  @Get('/')
  me(ctx: RequestContext) {
    const tenant = ctx.get('tenant')   // typed: { id: string; name: string }
    return ctx.json({ tenant })
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
class TenantAdapter implements AppAdapter {
  name = 'TenantAdapter'
  contributors() { return [LoadTenant.registration] }
}

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

What looks like one continuous `ctx` to your code is three separate JS objects. They all read and write the **same per-request `Map`** that lives inside an `AsyncLocalStorage` frame (`requestStore.getStore().values`). That's how data flows from the contributor into the handler — through the ALS-backed Map, not through shared object identity.

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

Services don't need a `ctx` reference to read contributor output — they can pull from the ALS store directly:

```ts
import { Service, requestStore } from '@forinda/kickjs'

@Service()
class AuditService {
  log(action: string) {
    const store = requestStore.getStore()
    const tenantId = store?.values.get('tenant')?.id
    db.audit.insert({ action, tenantId, requestId: store?.requestId })
  }
}
```

`store` is `undefined` outside a request (background jobs, startup, tests without `requestScopeMiddleware()`). Always null-check.

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
  Use \`ctx.get('tenant')\` in handlers; use \`requestStore.getStore()?.values.get('tenant')\`
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

## Testing in isolation

For unit-testing a contributor without booting an Express app, see [`runContributor`](./testing.md) in the `@forinda/kickjs-testing` package. It builds a one-contributor pipeline against a stub `ExecutionContext` so you can assert on the `ctx.set` value without standing up routes, modules, or middleware.

For end-to-end integration tests (multi-contributor pipeline + real handler), use `createTestApp([Module])` from `@forinda/kickjs-testing` with a request that triggers the route — the same ALS-backed Map flow described above runs unchanged.
