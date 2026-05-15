# @forinda/kickjs

## 5.7.0

### Minor Changes

- [#236](https://github.com/forinda/kick-js/pull/236) [`a5e6a33`](https://github.com/forinda/kick-js/commit/a5e6a331af581d62022025e499ff496055a9f89a) Thanks [@forinda](https://github.com/forinda)! - fix: close the four DX rough edges from forinda/kick-js#235

  Bundles all four reported issues into one PR per the request. Each lands independently — the failing surface for one didn't depend on any other — but a stacked PR keeps the review and CHANGELOG entry coherent.

  ### §1 — `ContextDecoratorTarget` is now publicly exported

  Adopters wrapping `defineHttpContextDecorator(...)` in a public method-decorator factory hit `TS4058` under `declaration: true` builds because the inferred return type referenced an internal symbol. The interface was already exported from `core/context-decorator.ts`; it just wasn't re-exported from `core/index.ts`. One-line fix — adopters can now annotate their wrapper's return type as `ContextDecoratorTarget` instead of re-deriving the legacy `MethodDecorator` shape locally.

  ```ts
  import {
    defineHttpContextDecorator,
    type ContextDecoratorTarget,
  } from '@forinda/kickjs'

  const RequirePermissionContext = defineHttpContextDecorator<...>({...})

  export function RequirePermission(code: PermissionCode): ContextDecoratorTarget {
    return RequirePermissionContext({ permissionCode: code })
  }
  ```

  ### §2 — `@Autowired` and `@Inject` work in either position

  Both decorators now accept the property-decorator position AND the constructor-parameter-decorator position. Pick whichever name reads better at the call site:

  ```ts
  @Service()
  class UserRepo {
    // Property position — both names work.
    @Autowired(DB) private db1!: KickDbClient
    @Inject(DB) private db2!: KickDbClient

    // Constructor parameter position — both names work.
    constructor(
      @Autowired(LOGGER) private logger: Logger,
      @Inject(CACHE) private cache: Cache,
    ) {}
  }
  ```

  Runtime detects the position via the standard "third arg is a number" check (TypeScript's legacy parameter decorator signature) and routes to the correct metadata bucket (`AUTOWIRED` for properties keyed by prototype + name, `INJECT` for params keyed by constructor + index). The pre-existing no-token reflection-based forms (`@Autowired() private foo!: SomeClass` and `@Inject(SomeClass) foo`) keep working unchanged — `design:type` / `design:paramtypes` fallback still fires when token is undefined.

  7 new unit cases in `packages/kickjs/__tests__/inject-autowired-positions.test.ts` lock the matrix.

  ### §3 — mount-prefix `:params` propagate into `ctx.params` types

  Controllers mounted under a path with parameters (e.g. `/control/orgs/:id/extensions`) no longer need `params: orgIdParamsSchema` repeated on every route to type `ctx.params.id`. The typegen scanner now extracts each module's `routes()` body for `{ path, controller }` pairs and combines the mount path with the per-route path before extracting `:params`. Per-route `params: schema` declarations still override (schema wins over the URL-pattern fallback, as before).

  Multi-mount controllers (rare, e.g. v1 + v2 versioned variants) take the first mount's prefix; the per-route `params: schema` escape hatch handles asymmetric cases.

  6 new unit cases in `packages/cli/__tests__/scanner-mount-path-params.test.ts`.

  ### §4 — typegen warns when a decorated file isn't picked up by any module glob

  The default module template generates `import.meta.glob([patterns])` to side-effect-register decorated classes. Adopters who add a new file type (e.g. `context-decorators/*.ts`) and forget to extend the glob got silent registration drift — the decorator never fires, downstream hits a confusing `MissingContributorError` at request time.

  The typegen scanner now extracts every module file's globs, matches each decorated class file in the module subtree against them, and emits a `console.warn` for orphans:

  ```text
    kick typegen: 1 decorated class(es) not matched by any module's import.meta.glob():
      @Service RequireExtensionEnabled (src/modules/ext/context-decorators/require-extension.ts)
        → not picked up by any glob in src/modules/ext/ext.module.ts
  ```

  Surfaced at every `kick typegen` (and `kick dev` pre-typecheck) run. Doesn't fail the build — adopters who deliberately exclude files keep working — but the orphan is impossible to miss.

  9 new unit cases across `packages/cli/__tests__/scanner-orphaned-classes.test.ts` lock the glob-to-regex translator (`**/` → `(?:.+/)?`, `*` → `[^/]*`, `?` → `.`, negation patterns subtract) and `fileMatchesAnyGlob` semantics.

  ### Numbers

  | Package               | Before    | After           |
  | --------------------- | --------- | --------------- |
  | `@forinda/kickjs`     | 408 tests | 415 tests (+7)  |
  | `@forinda/kickjs-cli` | 276 tests | 291 tests (+15) |

  Minor bumps — all changes additive. Both `@Autowired`/`@Inject` working in either position is a behaviour widening (previously rejected positions now accept) so technically minor; the rest are additive surface (`ContextDecoratorTarget` export, new typegen warning) or scanner internals.

## 5.6.0

### Minor Changes

- [#221](https://github.com/forinda/kick-js/pull/221) [`7bc0d23`](https://github.com/forinda/kick-js/commit/7bc0d23084e1fcb8df346856dfb16bb5bd2f2f13) Thanks [@forinda](https://github.com/forinda)! - feat(kickjs): `RequestContext.signal` — `AbortSignal` for request-scoped cancellation

  `RequestContext` now exposes a `signal: AbortSignal` getter that fires when the underlying HTTP request closes (client disconnect, response sent, or timeout). Thread it through anything that takes an `AbortSignal` so the work cancels as soon as the client gives up.

  ```ts
  import { Controller, Get, Autowired, type RequestContext } from '@forinda/kickjs'
  import { TasksRepository } from './tasks.repository'

  @Controller()
  export class TasksController {
    @Autowired() private readonly tasks!: TasksRepository

    @Get('/:id/full')
    async showFull(ctx: RequestContext) {
      const row = await this.tasks.findFullById(ctx.params.id as string, ctx.signal)
      if (!row) return ctx.notFound()
      ctx.json(row)
    }
  }
  ```

  The repo passes `signal` to `db.query.<table>.findUnique({ signal })`; if the client disconnects mid-flight, kickjs-db's M5.A.2 plumbing maps the abort to `RelationalQueryCancelledError` and short-circuits the in-flight query instead of churning a connection until completion.

  **Why this exists** — M5.A.2 (`@forinda/kickjs-db@5.6.0`) shipped the `signal?: AbortSignal` option on `FindManyOptions` / `FindFirstOptions` / `FindUniqueOptions` with a docstring that pointed adopters at "`RequestContext.signal` from kickjs-http". `RequestContext.signal` didn't actually exist yet; this release closes that gap so the integration story is honoured end-to-end.

  **Implementation note** — the per-request `AbortController` is cached on the underlying `req` object via a Symbol key, so the multiple `RequestContext` wrappers that router-builder constructs (one per middleware, one per contributor pipeline, one for the main handler) all observe the same signal. The signal aborts on either `req.on('close')` or `res.on('close')` — whichever fires first; subsequent closes are no-ops.

  Tests: 6 new unit cases in `packages/kickjs/__tests__/context-signal.test.ts` — initial-state, request-close abort, response-close abort, identity stability, shared-controller across multiple `RequestContext` wrappers for the same `req`, idempotency on repeated abort.

  Demonstrated end-to-end in `examples/task-kickdb-api`: `TasksController.showFull` (`GET /tasks/:id/full`), `WorkspacesController.showFull` (`GET /workspaces/:id/full`), and `WorkspacesController.ownedBy` (`GET /workspaces/owned-by/:userId`) all thread `ctx.signal` into the corresponding `findFullById` / `listOwnedByUser` repo methods.

  Closes the M5 exit-gate item that referenced `ctx.signal` literally. Additive — no breaking change. M5 "no major bumps" rule respected.

## 5.5.0

### Minor Changes

- [#191](https://github.com/forinda/kick-js/pull/191) [`dc86690`](https://github.com/forinda/kick-js/commit/dc866902a7ed736f0c16e4d7fd2eb44c55816077) Thanks [@forinda](https://github.com/forinda)! - `defineModule()` factory + simplified `routes()` shape — the fourth `define*` primitive lands and the codegen + docs sweep follows.

  ## `defineModule()` — new factory

  Mirrors `defineAdapter` / `definePlugin` / `defineContextDecorator` so adopters learn one mental model across all four primitives. The legacy `class FooModule implements AppModule { ... }` form keeps working — `bootstrap` accepts either shape and the loader discriminates at boot.

  ```ts
  const TasksModule = defineModule({
    name: 'TasksModule',
    defaults: { scope: 'public' },
    build: (config, { name }) => ({
      register(container) {
        container.registerInstance(`tasks:scope:${name}`, config.scope)
      },
      routes() {
        return { path: `/${config.scope}/tasks`, controller: TasksController }
      },
      contributors() {
        return [LoadTenant.registration]
      },
    }),
  })

  bootstrap({
    modules: [
      TasksModule(), // public scope (defaults)
      TasksModule.scoped('admin', { scope: 'admin' }), // namespaced clone
    ],
  })
  ```

  - `(config?)` call form returns the module instance.
  - `.scoped(scopeName, config?)` returns a namespaced instance (build-context name becomes `${moduleName}:${scope}`).
  - `.definition` exposes the frozen options snapshot for tooling.

  `.async()` is intentionally **not** part of the surface. Module config has no async-resolution window: `register()` and `routes()` both run synchronously during bootstrap, before any adapter `beforeStart` hook fires. Adopters who need async-resolved config push it into an adapter and inject the resolved value into the module via DI tokens.

  Boot-time validation: missing `name`, missing `build`, non-function `build`, non-object options all throw `TypeError` immediately (typically module-load) so adopters get a clear error before bootstrap.

  ## `AppModuleEntry` union type

  `bootstrap({ modules })`, `KickPlugin.modules?()`, and `createTestApp({ modules })` now accept `AppModuleEntry = AppModuleClass | AppModule` so `defineModule`-output instances and legacy classes mix freely in the same array. The Application loader discriminates `typeof entry === 'function'` to dispatch — classes get `new`-ed, instances are used directly.

  ## `defineModules()` — fluent module-list builder

  ```ts
  import { bootstrap, defineModules } from '@forinda/kickjs'

  const modules = defineModules().mount(HelloModule()).mount(TasksModule()).mount(AdminModule())

  await bootstrap({ modules })
  ```

  `defineModules()` returns a `ModuleList` (an `AppModuleEntry[]` subclass with a chainable `.mount()`). Drops into `bootstrap({ modules })` directly — no unwrap step — because `ModuleList extends Array<AppModuleEntry>`. Optional vararg seeds the list inline: `defineModules(HelloModule()).mount(TasksModule())` composes the two forms naturally.

  The plain `[X(), Y()]` array form keeps working — `defineModules()` is the fluent alternative for adopters who prefer the call-then-call pattern that mirrors `definePlugin().scoped(...)` / `defineAdapter()` elsewhere in the framework. Both produce the same shape internally.

  ## `ModuleRoutes` simplified — `controller` alone is sufficient

  ```ts
  // Before
  routes(): ModuleRoutes {
    return {
      path: '/users',
      router: buildRoutes(UserController),
      controller: UserController,
    }
  }

  // After
  routes() {
    return {
      path: '/users',
      controller: UserController,  // framework derives router via buildRoutes() internally
    }
  }
  ```

  The `router` field is now optional — when omitted, the framework calls `buildRoutes(controller)` itself. `controller` was already required for OpenAPI introspection via `SwaggerAdapter`, so the simplification removes the redundant `router: buildRoutes(...)` boilerplate without losing capability. Adopters who hand-build a router (composing multiple controllers, mounting third-party routers) keep passing `router` directly — both shapes are supported.

  Existing modules that still pass `router: buildRoutes(...)` keep working untouched. The new shape just removes the boilerplate going forward.

  ## CLI codegen sweep — `@forinda/kickjs-cli`

  Every module template (`generateModuleIndex` DDD, `generateRestModuleIndex`, `generateMinimalModuleIndex`, `cqrs.ts`'s `generateCqrsModuleIndex`, `scaffold.ts`'s `genModuleIndex`, `project-app.ts`'s `generateHelloModule`) now emits the `defineModule({ name, build })` form with the simplified `{ path, controller }` route shape.

  Each generated `routes()` carries a JSDoc hint demonstrating the array-return + per-entry `version` override so adopters discover that surface from the generated file, not from a separate doc:

  ```ts
  /**
   * Return an array to mount multiple route sets — each entry can
   * override the API version with a `version` field — the mount path
   * becomes `/{apiPrefix}/v{version}{path}`:
   *
   *   return [
   *     { path: '/tasks', version: 1, controller: TasksV1Controller },
   *     { path: '/tasks', version: 2, controller: TasksV2Controller },
   *   ]
   */
  ```

  The `kick g module` orchestrator updates `src/modules/index.ts` to insert the factory-call form (`TasksModule()`) — the type annotation switches from `AppModuleClass[]` to `AppModuleEntry[]`. The `kick rm module` regex updated to match both `Module` and `Module()` forms.

  The `definePlugin` generator's `modules()` return type updated to `AppModuleEntry[]` with a comment explaining that both class and factory forms work.

  The `kick g scaffold` command now refuses with an actionable message when the project pattern isn't `'ddd'` — the field-based scaffold templates only support the DDD layout today, so non-DDD projects need to use `kick g module` until the scaffold variants land.

  ## `@forinda/kickjs-testing`

  `CreateTestAppOptions.modules` switches to `AppModuleEntry[]` so test apps accept both shapes. The isolated-container path inside `createTestApp` discriminates class vs instance the same way Application does — classes get `new`-ed, factory output is used directly. `KickPlugin.modules()` typing in the test-plugin harness updated in lockstep.

  ## Docs sweep

  Active adopter-facing guides updated: `docs/guide/modules.md` (full rewrite leading with `defineModule`), `getting-started.md`, `project-structure.md` (canonical examples). `plugins.md`, `migration-from-express.md`, `testing.md`, `generators.md`, `tutorial-hmr-decorators.md`, `tutorial-generator-patterns.md` get the type-annotation rename so the `AppModuleEntry[]` story is consistent across the docs site. Versioned snapshots under `docs/versions/` left untouched (they're locked to their respective releases).

  ## What's deferred
  - `kick g scaffold` for REST / CQRS / minimal patterns — currently only emits DDD-shaped layouts. The command refuses on non-DDD projects with a clear error pointing at `kick g module` as the workaround.
  - Module-registry pattern for plugins (`.mount(module)` / `.use(module)` factory) — separate design conversation; the flat-array `modules?(): AppModuleEntry[]` is the stable shape for now.

- [#192](https://github.com/forinda/kick-js/pull/192) [`f5c91f5`](https://github.com/forinda/kick-js/commit/f5c91f53bb42af4ae42eb3fdec4b1d9f312ad1f0) Thanks [@forinda](https://github.com/forinda)! - `ModuleRegistry` + `setup(registry)` callback — imperative module registration alongside the static `modules: [...]` array. Lays the foundation for `.use(module)` (non-HTTP modules) without committing to its semantics yet.

  ## What's new

  ```ts
  import { bootstrap } from '@forinda/kickjs'

  await bootstrap({
    modules: [HelloModule()], // static — always mounted

    setup(registry) {
      if (process.env.ENABLE_ADMIN === 'true') {
        registry.mount(AdminModule())
      }
      for (const tenant of TENANTS) {
        registry.mount(TenantModule.scoped(tenant.id, tenant))
      }
    },
  })
  ```

  - New `ModuleRegistry` type with one method: `.mount(module: AppModuleEntry)`. Internal collector `MutableModuleRegistry` is what bootstrap passes around; adopters interact through the interface.
  - New `ApplicationOptions.setup?(registry: ModuleRegistry)` callback on `bootstrap()`.
  - New `KickPlugin.setup?(registry: ModuleRegistry)` lifecycle hook on plugins. Runs after `plugin.modules?()` so plugins can mix static + dynamic registration in the same plugin.

  Order across the whole pipeline (preserved across bootstrap):
  1. plugin static modules (`plugin.modules?()`)
  2. plugin `setup()` calls (in plugin dependsOn-sorted order)
  3. user static modules (`options.modules`)
  4. user `setup()` callback

  The static `modules: [...]` array keeps working unchanged — `setup` is purely additive.

  ## Why only `.mount(module)` (not `.use`)

  `.mount` covers the HTTP-feature path that drives most adopter use today. A future `.use(module)` is planned for non-HTTP modules (queues, cron, workers, DI-only seeds) — adding it later won't be a breaking change because `ModuleRegistry` is the adopter-facing type and `mount()` is the only stable method on it now. Existing non-HTTP modules continue returning `null` from `routes()` and using `.mount()` (or staying in the static array) until `.use` lands.

  ## Soft deprecation

  `AppModuleClass` now carries a `@deprecated` JSDoc tag pointing at `defineModule({...})` + `AppModuleEntry`. The class form keeps working through v5 — no runtime warnings, no breaking changes — the annotation is a soft "prefer the factory form" hint shown in IDE tooltips.

  ## Tests
  - `MutableModuleRegistry`: starts-empty, mount-appends-in-order, accepts both class and instance forms, referentially-stable entries array, surface only exposes `mount`.
  - Application integration: bootstrap setup callback runs and threads mounts through the loader; plugin.setup runs before bootstrap.setup; missing setup is backwards compatible; plugin setup threads captured config.

  Suite: 375 → 385 tests (+10). Build + typecheck clean.

  ## Docs

  `docs/guide/modules.md` gains a "Conditional registration — `setup(registry)`" section. `docs/guide/plugins.md` adds `setup()` to the lifecycle table with a `modules() vs setup()` subsection covering when to use each.

### Patch Changes

- [#190](https://github.com/forinda/kick-js/pull/190) [`a812ad5`](https://github.com/forinda/kick-js/commit/a812ad5daa9c3acbe9583eec632a766dadafaea8) Thanks [@forinda](https://github.com/forinda)! - Harden `defineContextDecorator` based on review feedback. Six tightening passes, all backwards-compatible:
  1. **Boot-time spec validation.** `defineContextDecorator` now throws `TypeError` immediately if `spec` is missing/non-object, `spec.key` is empty, `spec.resolve` isn't a function, `spec.onError` is provided but not a function, or `spec.dependsOn` is provided but not an array. Adopters get definition-time errors (typically module load) instead of cryptic ContextMeta misses at first request.
  2. **Source-location capture.** Every registration now carries `definedAt: string` — a snapshot of `new Error().stack` taken at decorator-construction time. The contributor pipeline threads it into `MissingContributorError`'s message so boot-time errors print `declared at src/contributors/load-project.ts:42:18` instead of forcing adopters to grep for the key string.
  3. **Cleaner type story.** Replaced the trailing `as unknown as ContextDecorator<...>` double-cast with overloaded function signatures + `Object.assign` + `Object.freeze`. `decoratorOrFactory` now matches `ContextDecorator`'s call shapes structurally and properties are typed via the assign intersection — no more `as unknown` escape hatch in the factory's return path.
  4. **Meaningful `.name` on the returned decorator.** `console.log(LoadTenant)` now prints `[Function: ContextDecorator(tenant)]` instead of `[Function: decoratorOrFactory]`. Stack traces and devtools inspections name the contributor by its key.
  5. **Stale-comment sweep.** Dropped the "No runtime behaviour is wired in Phase 1" line — Phase 1 shipped, the topo-sort + runner + HTTP integration are all live. Replaced with a concrete pointer to the new boot-time validation.
  6. **Documented unsound `as D` cast.** `Object.freeze({ ...(spec.deps ?? ({} as D)) })` carries an inline comment explaining when the cast is sound (zero-deps default), when it isn't (non-empty `D` with `deps` omitted), and why the runner's loud-fail behaviour is the right tradeoff vs forcing `deps` non-optional in the spec.

  `MissingContributorError` gained a fourth optional constructor argument (`dependentDefinedAt?: string`) and a matching readonly field. Existing callers continue to work — the parameter is optional and falls back to the previous message format when absent.

  Suite: 366 → 373 tests (+7 — six validation cases + one declared-at assertion). Build + typecheck clean.

## 5.4.0

### Minor Changes

- [#169](https://github.com/forinda/kick-js/pull/169) [`937f514`](https://github.com/forinda/kick-js/commit/937f514d282111299298acabad931c0e7de5c8c7) Thanks [@forinda](https://github.com/forinda)! - `RequestContext.body`, `params`, `query`, `headers`, `file`, and `files`
  are now typed `DeepReadonly<T>` (or `Readonly<T>` for headers,
  `ReadonlyArray<...>` for files). This is a **type-only** change — no
  runtime difference, no `Object.freeze`, no perf cost — but adopter code
  that mutates these in place will start failing at compile time, **once
  `ctx` is properly typed**:

  ```ts
  // Before — silently accepted, even when bypassing Zod validation
  ctx.body.injectedField = 'computed'
  ctx.headers.authorization = 'fake'
  ctx.files!.push(extra)

  // After — tsc errors
  //   "Cannot assign to 'injectedField' because it is a read-only property."
  //   "Cannot assign to 'authorization' because it is a read-only property."
  //   "Property 'push' does not exist on type 'readonly any[]'."
  ```

  This matches the framework's existing rule — _writes flow through
  `ctx.set(key, value)` or a Context Contributor's return value, not by
  mutating the request bag in place_ — and now the type system enforces
  it.

  ::: tip Protection only kicks in for typed contexts
  The default generic for `RequestContext` is `any`, and `DeepReadonly<any>`
  collapses to `any`. Adopters who write `ctx: RequestContext` get no
  protection (and no breakage). Adopters who write
  `ctx: Ctx<KickRoutes.UserController['create']>` (or pass explicit
  generics like `RequestContext<CreateUserBody>`) get the readonly
  locks the changeset describes. The CLI scaffolders (`kick g scaffold`,
  `kick g controller`) already emit `Ctx<KickRoutes…>` by default, so
  freshly generated controllers see the protection automatically.
  :::

  ### Migration

  Most usages already comply. If you mutate one of these surfaces
  intentionally, two escape hatches:
  1. **Compute and stash** (preferred):
     ```ts
     const enriched = { ...ctx.body, computed: f(ctx.body) }
     ctx.set('enrichedBody', enriched)
     ```
  2. **Drop down to the raw Express handle**:
     ```ts
     ;(ctx.req.body as any).injectedField = 'computed'
     ```

  The escape hatches stay supported. The default just stops surprising
  adopters who validated a payload with Zod, then watched a downstream
  middleware silently mutate it.

  `ctx.session`, `ctx.user`, `ctx.cookies`, and `ctx.requestId` are
  unchanged — those have legitimate write-side flows (auth strategies,
  session stores, etc.) and wrapping them in `Readonly` would create
  real friction.

  A new `DeepReadonly<T>` type alias is exported from
  `@forinda/kickjs` for adopters who want to apply the same lock to
  their own typed payloads.

## 5.3.1

### Patch Changes

- [#166](https://github.com/forinda/kick-js/pull/166) [`a6d0dd6`](https://github.com/forinda/kick-js/commit/a6d0dd6038b215c0ae3cbe1a20e11ba0d8b1c46e) Thanks [@forinda](https://github.com/forinda)! - Minify published build output via the tsdown / oxc minifier.
  - **Library packages** use `minify: { compress: true, mangle: false }`. Whitespace and comments are stripped and constants folded, but identifiers stay intact so adopter stack traces remain readable.
  - **CLI** uses `minify: { compress: true, mangle: true }`. The CLI is an operator tool, not a library — full mangle is fine and gives a smaller binary.

  Net effect: roughly 30–40% smaller `dist/*.mjs` per package on disk, no public-API or behavior change.

## 5.3.0

### Minor Changes

- [#161](https://github.com/forinda/kick-js/pull/161) [`5de61d9`](https://github.com/forinda/kick-js/commit/5de61d9a9cd99bac3e1e271a36b092fa7bf7ad98) Thanks [@forinda](https://github.com/forinda)! - Add `withBuilder()` factory alongside `@Builder`. Both share the same runtime via the new internal `attachBuilder()` helper.

  ```ts
  // Decorator form — opt into typing with one line
  @Builder
  class UserDto {
    name!: string
    email!: string
    declare static readonly builder: () => BuilderOf<UserDto>
  }

  // Factory form — same runtime, types inferred automatically
  class TaskDtoBase {
    title!: string
    done!: boolean
  }
  export const TaskDto = withBuilder(TaskDtoBase)
  export type TaskDto = InstanceType<typeof TaskDto>
  ```

  `readonly` keeps SonarQube's `typescript:S1444` quiet — the runtime assigns `target.builder` once at decoration time and never reassigns it. Existing `@Builder` adopters keep working without changes; the typing opt-in is additive.
