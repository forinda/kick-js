import 'reflect-metadata'
import { METADATA, type Constructor, type MaybePromise } from './interfaces'
import { pushClassMeta, pushMethodMeta } from './metadata'
import type { InjectionToken } from './token'
import type { ContextKeys, ContextMeta, ExecutionContext, MetaValue } from './execution-context'

/**
 * String-literal union of every known context key — the union of the
 * keys declared on {@link ContextKeys} (key-only registry) and
 * {@link ContextMeta} (value-type registry). Resolves to `string` when
 * the project hasn't augmented either yet (so a first-day project keeps
 * compiling), and narrows to the concrete keys once the
 * `declare module '@forinda/kickjs' { interface ContextKeys/ContextMeta { ... } }`
 * blocks land.
 *
 * Used as the element type of `dependsOn`, so a typo like
 * `dependsOn: ['tenent']` becomes a TS error instead of a boot-time
 * `MissingContributorError`.
 *
 * Unioning BOTH registries is deliberate: it means adding a value type
 * via `ContextMeta` automatically makes that key a valid `dependsOn`
 * target, and you can register a dependsOn-able key in `ContextKeys`
 * without being forced to give it a value type. (Before the split,
 * `dependsOn` was keyed off `ContextMeta` alone, so augmenting
 * `ContextMeta` for some keys broke `dependsOn` for every key you
 * hadn't added there.)
 */
type KnownContextKey = keyof ContextMeta | keyof ContextKeys
export type ContextMetaKey = [KnownContextKey] extends [never] ? string : KnownContextKey & string

/**
 * What a single `deps` entry is allowed to be — the runtime calls
 * `container.resolve(value)`, which accepts an injection token brand
 * or a constructor (decorated class). Anything else (a string literal,
 * an array, a plain object) silently fails at boot when the runner
 * tries to resolve it; constraining at the type level surfaces the
 * mistake in the editor instead.
 */
export type DepValue = InjectionToken<unknown> | Constructor<unknown>

/**
 * Maps a `deps` declaration object to its resolved-instance shape.
 *
 * `deps: { db: DB_TOKEN, cache: CacheService }` produces
 * `{ db: Db, cache: CacheService }` — the runner resolves each value
 * against the DI container and hands the result to `resolve()`.
 */
export type ResolvedDeps<D extends Record<string, DepValue>> = {
  [K in keyof D]: D[K] extends InjectionToken<infer T>
    ? T
    : D[K] extends Constructor<infer T>
      ? T
      : never
}

/**
 * Keys of `T` that are declared required (i.e. not `?`-optional).
 */
type RequiredParamKeys<T> = {
  // eslint-disable-next-line @typescript-eslint/ban-types
  [K in keyof T]-?: {} extends Pick<T, K> ? never : K
}[keyof T]

/**
 * Params a call site MUST supply: the required keys of `P` that
 * `paramDefaults` (type `PD`) doesn't already provide.
 *
 * The `string extends keyof P` guard short-circuits the index-signature
 * case — `P` defaults to `Record<string, never>` for the overwhelmingly
 * common zero-params contributor, and a mapped type over `string` would
 * otherwise report "every key is required" and break `@Foo` for every
 * existing decorator in the wild.
 */
export type MissingParamKeys<P, PD> = string extends keyof P
  ? never
  : Exclude<RequiredParamKeys<P>, keyof PD>

/**
 * The argument type for a call site (`@Foo({...})`, `.with({...})`).
 *
 * `Partial<P>` when every required field has a default, so adopters keep
 * overriding just the fields they care about. Otherwise `Partial<P>`
 * intersected with the undefaulted required fields, making those
 * mandatory at each call site.
 */
export type CallSiteParams<P, PD> = [MissingParamKeys<P, PD>] extends [never]
  ? Partial<P>
  : Partial<P> & Pick<P, MissingParamKeys<P, PD> & keyof P>

/**
 * Spec passed to {@link defineContextDecorator}. Describes one entry in
 * the per-request contributor pipeline.
 *
 * @typeParam K   - The {@link ContextMeta} key this contributor populates.
 * @typeParam D   - DI dependency declaration shape (see {@link ResolvedDeps}).
 * @typeParam Ctx - Concrete execution-context type. Defaults to the abstract
 *                  {@link ExecutionContext}; HTTP contributors typically
 *                  default to `RequestContext` at the call site.
 * @typeParam PD  - Inferred from `paramDefaults`. Drives which params each
 *                  call site is required to supply — see {@link CallSiteParams}.
 *                  Never spell this by hand.
 */
export interface ContextDecoratorSpec<
  K extends string = string,
  D extends Record<string, DepValue> = Record<string, never>,
  P extends Record<string, unknown> = Record<string, never>,
  Ctx extends ExecutionContext = ExecutionContext,
  PD extends Partial<P> = Partial<P>,
> {
  /** ContextMeta key the resolved value is written to. */
  key: K
  /**
   * DI dependencies resolved by the runner before `resolve()` runs.
   * Map entry keys become property names on the resolved-deps argument
   * passed to `resolve()`.
   */
  deps?: D
  /**
   * Other contributor keys that must populate before this one runs.
   * Enforced via topo-sort at startup; missing deps and cycles fail boot.
   *
   * Typed against {@link ContextMetaKey} — the union of `keyof ContextMeta`
   * and `keyof ContextKeys` — once the project augments either, so
   * `dependsOn: ['tenent']` (typo) is a TS error, not a boot-time
   * `MissingContributorError`. Falls back to plain `string[]` when both
   * registries are empty (no augmentation yet) so first-day projects keep
   * compiling. Cast escape hatch: `dependsOn: ['custom-key' as ContextMetaKey]`.
   */
  dependsOn?: readonly ContextMetaKey[]
  /**
   * If `true`, a thrown `resolve` skips the contributor instead of
   * forwarding to the request error handler. The key is left unset
   * and downstream consumers see `ctx.get(key) === undefined`.
   */
  optional?: boolean
  /**
   * Default per-call params merged with the call-site params; call-site
   * wins. When omitted, params default to `{}` and the resolver
   * receives an empty object — back-compat with today's zero-arg
   * decorators.
   *
   * Param shape is intentionally unconstrained: plain data, functions,
   * and closures are all valid. Adopters who want runtime validation
   * should perform it inside `resolve()` — keeps the framework
   * validator-agnostic so projects can plug Zod / Valibot / hand-rolled
   * checks without the framework caring.
   *
   * **Required fields are enforced at the call site.** A required field
   * of `P` that has no entry here must be supplied wherever the
   * decorator is applied — `@Foo({ action: 'audit:read' })`. The bare
   * `@Foo` form and `.registration` stop type-checking for such a
   * decorator, because neither can supply the value.
   *
   * This exists so nobody has to invent a meaningless default just to
   * satisfy the type (`action: 'settings:read'` on a permission
   * contributor every call site overrides anyway). A default that is
   * never correct is worse than no default: forget the argument at one
   * call site and the route silently gates on the placeholder instead
   * of failing to compile.
   *
   * Omit this entirely for the common zero-params case — `P` defaults
   * to `Record<string, never>`, which requires nothing.
   */
  paramDefaults?: PD
  /**
   * Runtime mirror of the compile-time requirement above: param names
   * that must be present after merging call-site params over
   * `paramDefaults`. A missing one throws `TypeError` at the point of
   * use (decoration time for `@Foo`, call time for `@Foo({...})` /
   * `.with({...})`), naming the decorator and the field.
   *
   * The type-level check already covers TypeScript call sites, so this
   * is for the paths types can't reach: plain-JS adopters, `as any`
   * escapes, and params assembled dynamically. Optional — list only
   * fields whose absence is a correctness bug rather than a default.
   */
  requiredParams?: readonly (keyof P & string)[]
  /**
   * Hook invoked when `resolve()` throws and `optional` is `false`.
   * Returning a value writes it to `ctx.set(key, …)`; returning
   * `undefined` / `void` skips. Throwing inside the hook forwards
   * the new error to the request error handler.
   *
   * Async-permitted by design — adopters frequently want to
   * `await auditService.log(err)` or `await cache.fallback(...)`.
   *
   * The third `params` argument carries the resolved per-call params
   * (call-site overrides merged on top of `paramDefaults`).
   */
  onError?: (err: unknown, ctx: Ctx, params: P) => MaybePromise<MetaValue<K> | undefined | void>
  /**
   * Compute and return the value to write into `ctx.set(key, …)`.
   *
   * The third `params` argument carries the resolved per-call params
   * (call-site overrides merged on top of `paramDefaults`). When the
   * decorator is applied zero-arg (`@Foo`), `params` equals
   * `paramDefaults` (or `{}` if defaults are omitted). When applied as
   * a factory (`@Foo({ ... })`), the call-site object is merged on top.
   */
  resolve: (ctx: Ctx, deps: ResolvedDeps<D>, params: P) => MaybePromise<MetaValue<K>>
}

/**
 * Internal, normalised registration produced by {@link defineContextDecorator}.
 *
 * Frozen and shared by every use site of the decorator (method, class,
 * module, adapter, global). The pipeline builder dedupes by `key` using
 * the precedence rule defined in §20.4 of `architecture.md`.
 */
export interface ContributorRegistration<
  K extends string = string,
  D extends Record<string, DepValue> = Record<string, never>,
  Ctx extends ExecutionContext = ExecutionContext,
> {
  readonly key: K
  readonly deps: D
  readonly dependsOn: readonly ContextMetaKey[]
  readonly optional: boolean
  /**
   * Per-call params from the spec are baked into the closure at
   * decorator-construction time, so the runner-facing `onError`
   * exposes only `(err, ctx)`.
   */
  readonly onError?: (err: unknown, ctx: Ctx) => MaybePromise<MetaValue<K> | undefined | void>
  /**
   * Per-call params from the spec are baked into the closure at
   * decorator-construction time, so the runner-facing `resolve`
   * exposes only `(ctx, deps)`. Adopters who write their own
   * registrations (without `defineContextDecorator`) match this
   * shape directly — params are an implementation detail of the
   * decorator factory, not of the runtime pipeline.
   */
  readonly resolve: (ctx: Ctx, deps: ResolvedDeps<D>) => MaybePromise<MetaValue<K>>
  /**
   * Stack snapshot captured the moment the decorator was defined.
   * Used by the contributor-pipeline builder to point boot-time
   * errors (`MissingContributorError`, `ContributorCycleError`,
   * `DuplicateContributorError`) at the adopter file that declared
   * the broken contributor — instead of forcing them to grep for
   * the key string.
   *
   * Optional because adopters who hand-roll a `ContributorRegistration`
   * (without `defineContextDecorator`) may not have a useful stack to
   * attach. Format is the raw `Error.stack` string; consumers slice
   * the first non-framework frame for display.
   */
  readonly definedAt?: string
}

/**
 * Type-erased registration shape used in the public collection slots
 * (`AppModule.contributors?()`, `AppAdapter.contributors?()`,
 * `KickPlugin.contributors?()`, `bootstrap({ contributors })`).
 *
 * The narrow `ContributorRegistration` carries a `Ctx` parameter so
 * `resolve(ctx, deps)` is typed at the *definition* site, but `Ctx`
 * sits in a contravariant position on `resolve` — meaning a
 * `ContributorRegistration<…, RequestContext>` is *not* assignable to
 * `ContributorRegistration<…, ExecutionContext>` even though every
 * `RequestContext` is-a `ExecutionContext`. That's TS-sound but
 * useless: the runner only ever calls a contributor with the same
 * concrete ctx the route mounts under, so an HTTP-typed contributor
 * never sees a non-HTTP ctx. Erasing `Ctx` to `any` in the collection
 * type lets adopters store contributors typed against `RequestContext`
 * (or any future transport-specific ctx) in the same array without
 * casting.
 */
export type AnyContributorRegistration = ContributorRegistration<
  string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any
>

/** Convenience alias for `AnyContributorRegistration[]` collections. */
export type ContributorRegistrations =
  | AnyContributorRegistration[]
  | readonly AnyContributorRegistration[]

/**
 * The decorator function returned by either a zero-arg
 * {@link ContextDecorator} application or a factory call. Overloaded
 * to satisfy both class and method decorator shapes — adopters apply
 * the same decorator to either site without TS rejecting the call.
 */
export interface ContextDecoratorTarget {
  /** Class decorator usage. */
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  (target: Function): void
  /** Method decorator usage. */
  (target: object, propertyKey: string | symbol, descriptor?: PropertyDescriptor): void
}

/**
 * The value returned by {@link defineContextDecorator}.
 *
 * Resolves to one of two shapes depending on whether every required
 * field of `P` has a `paramDefaults` entry:
 *
 * - {@link ContextDecoratorWithDefaults} — the classic shape. Usable
 *   bare (`@Foo`), as a factory (`@Foo({...})`), via `.with(params)`,
 *   and via `.registration`.
 * - {@link ContextDecoratorRequiringParams} — when `P` has required
 *   fields `paramDefaults` doesn't cover. Only the factory and
 *   `.with(params)` forms exist, because the others have no way to
 *   supply the missing values. Applying such a decorator bare is a
 *   compile error rather than a silent `undefined` at request time.
 *
 * `PD` is inferred from the spec's `paramDefaults`; the default here
 * (`Partial<P>`) keeps hand-written `ContextDecorator<K, D, P>`
 * annotations resolving to the permissive shape as before.
 */
export type ContextDecorator<
  K extends string = string,
  D extends Record<string, DepValue> = Record<string, never>,
  P extends Record<string, unknown> = Record<string, never>,
  Ctx extends ExecutionContext = ExecutionContext,
  PD = Partial<P>,
> = [MissingParamKeys<P, PD>] extends [never]
  ? ContextDecoratorWithDefaults<K, D, P, Ctx>
  : ContextDecoratorRequiringParams<K, D, P, Ctx, PD>

/**
 * Decorator whose params are fully defaulted (or which takes none).
 * Callable as a class or method decorator directly, as a factory, or
 * via `.with(params)` / `.registration` at non-decorator registration
 * sites.
 */
export interface ContextDecoratorWithDefaults<
  K extends string = string,
  D extends Record<string, DepValue> = Record<string, never>,
  P extends Record<string, unknown> = Record<string, never>,
  Ctx extends ExecutionContext = ExecutionContext,
> {
  /**
   * Class decorator usage with `paramDefaults` — `@Foo class C {}`.
   * The class constructor is a `Function`, so this overload only
   * matches actual classes (not plain object literals — which
   * fall through to the factory overload below).
   */
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  (target: Function): void
  /**
   * Method decorator usage with `paramDefaults` — `@Foo` over a
   * method. The required `propertyKey` distinguishes this from the
   * factory overload's single-object-arg call shape.
   */
  (target: object, propertyKey: string | symbol, descriptor?: PropertyDescriptor): void
  /**
   * Zero-arg factory usage — `@Foo()` returns a decorator with
   * `paramDefaults` applied. Equivalent in behaviour to the bare
   * `@Foo` form, exposed here so adopters who prefer "always call the
   * factory" don't need an `as any` cast.
   */
  (): ContextDecoratorTarget
  /**
   * Factory usage — `@Foo({ ... })` returns the actual decorator with
   * call-site params merged onto `paramDefaults`. Matches a single
   * params object; plain objects don't satisfy the `Function` /
   * 2-arg-minimum constraints above, so TS picks this overload.
   *
   * Accepts `Partial<P>` so adopters can override only the fields
   * they care about — anything missing falls back to `paramDefaults`
   * at runtime. Inside `resolve()`, `params` is the fully merged
   * `P`, never a `Partial<P>`.
   *
   * The returned decorator is overloaded for class AND method usage —
   * `@Foo({...}) class C {}` and `@Foo({...}) m() {}` both type-check.
   */
  (params: Partial<P>): ContextDecoratorTarget
  /**
   * Bare registration — uses `paramDefaults` only. Use this at non-
   * decorator registration sites (module / adapter / bootstrap) when
   * the call site doesn't need to override params.
   */
  readonly registration: ContributorRegistration<K, D, Ctx>
  /**
   * Build a registration with call-site params merged onto
   * `paramDefaults`. Use this at non-decorator registration sites
   * when the call site DOES want to override params:
   *
   * ```ts
   * bootstrap({
   *   contributors: [LoadTenant.with({ source: 'subdomain' }).registration],
   * })
   * ```
   *
   * `Partial<P>` for the same reason as the factory overload — the
   * runtime merges with `paramDefaults`, so adopters only specify
   * fields they want to override.
   */
  with(params: Partial<P>): { readonly registration: ContributorRegistration<K, D, Ctx> }
}

/**
 * Decorator with at least one required param that `paramDefaults`
 * doesn't cover. Deliberately narrower than
 * {@link ContextDecoratorWithDefaults}: the bare `@Foo` form, the
 * zero-arg `@Foo()` form, and the `.registration` accessor are all
 * absent, because none of them can supply the missing value.
 *
 * ```ts
 * const OperatorPerm = defineContextDecorator.withParams<{ action: string }>()({
 *   key: 'operatorPerm',
 *   resolve: (ctx, _deps, { action }) => check(ctx, action),
 * })
 *
 * class Ops {
 *   @OperatorPerm                     // ✗ compile error — `action` missing
 *   @Get('/a')
 *   a(ctx: RequestContext) {}
 *
 *   @OperatorPerm({ action: 'read' }) // ✓
 *   @Get('/b')
 *   b(ctx: RequestContext) {}
 * }
 * ```
 *
 * If you want the bare form back, give `action` a default in
 * `paramDefaults` — but only when the default is genuinely correct for
 * an undecorated route, which for a permission string it usually isn't.
 */
export interface ContextDecoratorRequiringParams<
  K extends string = string,
  D extends Record<string, DepValue> = Record<string, never>,
  P extends Record<string, unknown> = Record<string, never>,
  Ctx extends ExecutionContext = ExecutionContext,
  PD = Partial<P>,
> {
  /**
   * Factory usage — the only decorator form available here. The
   * argument type carries every required field `paramDefaults` didn't
   * provide, so omitting one is a compile error at this call site.
   */
  (params: CallSiteParams<P, PD>): ContextDecoratorTarget
  /**
   * Build a registration for non-decorator registration sites. Same
   * required-field rule as the factory form.
   */
  with(params: CallSiteParams<P, PD>): {
    readonly registration: ContributorRegistration<K, D, Ctx>
  }
}

/**
 * Curried params-first helper for {@link defineContextDecorator}.
 *
 * Solves the partial-inference problem: TS generics are positional, so
 * the moment an adopter wants to specify the per-call params shape
 * `P`, they're forced to spell `K` and `D` by hand — losing the
 * automatic `deps` inference that drives the `(ctx, deps, params) =>`
 * resolver signature:
 *
 * ```ts
 * // ❌ Positional generics — must repeat the deps type, and `D` no
 * // longer flows from `spec.deps` into `resolve(ctx, deps, ...)`.
 * defineContextDecorator<'tenant', { repo: typeof TENANT_REPO }, MyParams>({
 *   key: 'tenant',
 *   deps: { repo: TENANT_REPO },
 *   resolve: (ctx, { repo }, params) => ...,
 * })
 *
 * // ✅ Curried form — only `P` is spelled; `K`, `D`, `Ctx` infer.
 * defineContextDecorator.withParams<MyParams>()({
 *   key: 'tenant',
 *   deps: { repo: TENANT_REPO },     // D inferred
 *   resolve: (ctx, { repo }, params) => ..., // deps + params both typed
 * })
 * ```
 *
 * Use this whenever the contributor takes call-site params; use the
 * positional form when there are no params (the common case).
 */
export interface DefineContextDecoratorWithParams<P extends Record<string, unknown>> {
  <
    K extends string,
    D extends Record<string, DepValue> = Record<string, never>,
    Ctx extends ExecutionContext = ExecutionContext,
    // Inferred from `spec.paramDefaults`. The `Record<never, never>`
    // default (NOT `Partial<P>`) is what makes an omitted `paramDefaults`
    // mean "nothing is defaulted" — so every required field of `P` lands
    // on the call site. `Partial<P>` here would make `keyof PD` cover all
    // of `P` and silently defeat the whole check.
    PD extends Partial<P> = Record<never, never>,
  >(
    spec: ContextDecoratorSpec<K, D, P, Ctx, PD>,
  ): ContextDecorator<K, D, P, Ctx, PD>
}

/**
 * The public shape of {@link defineContextDecorator}. Combines the
 * original positional-generic call signature with the curried
 * `.withParams<P>()` helper that fixes partial-inference for the
 * parameterised case.
 */
export interface DefineContextDecoratorFn {
  <
    K extends string,
    D extends Record<string, DepValue> = Record<string, never>,
    P extends Record<string, unknown> = Record<string, never>,
    Ctx extends ExecutionContext = ExecutionContext,
    PD extends Partial<P> = Record<never, never>,
  >(
    spec: ContextDecoratorSpec<K, D, P, Ctx, PD>,
  ): ContextDecorator<K, D, P, Ctx, PD>

  /**
   * Curried entry point. Spell only the per-call params shape `P`;
   * `K`, `D`, and `Ctx` are inferred from the spec passed to the
   * returned function. See {@link DefineContextDecoratorWithParams}
   * for the rationale.
   */
  withParams<P extends Record<string, unknown>>(): DefineContextDecoratorWithParams<P>
}

/**
 * Define a typed context contributor.
 *
 * The returned function works as a method or class decorator:
 *
 * ```ts
 * const LoadTenant = defineContextDecorator({
 *   key: 'tenant',
 *   deps: { tenants: TenantsRepo },
 *   resolve: (ctx, { tenants }) => tenants.findByHost(ctx.requestId),
 * })
 *
 * @LoadTenant
 * @Get('/me')
 * me(ctx: RequestContext) {
 *   ctx.get('tenant')   // typed via ContextMeta
 * }
 * ```
 *
 * For non-decorator registration (module/adapter/bootstrap), pass
 * `LoadTenant.registration` into the appropriate contributors list.
 *
 * Boot-time validation: a missing `resolve`, an empty `key`, or a
 * non-array `dependsOn` throws `TypeError` here at definition time
 * (typically module-load) rather than waiting for the first request.
 * See `architecture.md` §20 for the full pipeline plan.
 *
 * **Parameterised contributors:** TS generics are positional, so to
 * specify `P` (the per-call params shape) with this signature you
 * also have to spell `K` and `D` — which loses automatic `deps`
 * inference. Use {@link DefineContextDecoratorFn.withParams} instead:
 * `defineContextDecorator.withParams<MyParams>()(spec)`.
 */
function defineContextDecoratorImpl<
  K extends string,
  D extends Record<string, DepValue> = Record<string, never>,
  P extends Record<string, unknown> = Record<string, never>,
  Ctx extends ExecutionContext = ExecutionContext,
  PD extends Partial<P> = Record<never, never>,
>(spec: ContextDecoratorSpec<K, D, P, Ctx, PD>): ContextDecorator<K, D, P, Ctx, PD> {
  // ---- Boot-time validation --------------------------------------
  // Surface mistakes the moment `defineContextDecorator` is called
  // (typically module-load time) instead of letting them ride to
  // request time as cryptic ContextMeta misses or container failures.
  // Cheap, ~15 lines, catches a whole class of definition-time bugs.
  if (spec === null || typeof spec !== 'object') {
    throw new TypeError(
      'defineContextDecorator: spec must be an object literal. ' +
        'See architecture.md §20.4 for the spec shape.',
    )
  }
  if (typeof spec.key !== 'string' || spec.key.length === 0) {
    const got = typeof spec.key === 'string' ? '""' : typeof spec.key
    throw new TypeError(
      `defineContextDecorator: spec.key must be a non-empty string (got ${got}). ` +
        'Pick a name that matches a key declared on `ContextMeta` (or one of the framework keys).',
    )
  }
  if (typeof spec.resolve !== 'function') {
    throw new TypeError(
      `defineContextDecorator(${spec.key}): spec.resolve is required and must be a function ` +
        `(got ${typeof spec.resolve}). Each contributor needs a resolver that produces ` +
        `the value to write into ctx.set(${JSON.stringify(spec.key)}, …).`,
    )
  }
  if (spec.onError !== undefined && typeof spec.onError !== 'function') {
    throw new TypeError(
      `defineContextDecorator(${spec.key}): spec.onError must be a function when provided ` +
        `(got ${typeof spec.onError}).`,
    )
  }
  if (spec.dependsOn !== undefined && !Array.isArray(spec.dependsOn)) {
    throw new TypeError(
      `defineContextDecorator(${spec.key}): spec.dependsOn must be an array when provided ` +
        `(got ${typeof spec.dependsOn}).`,
    )
  }
  if (spec.requiredParams !== undefined && !Array.isArray(spec.requiredParams)) {
    throw new TypeError(
      `defineContextDecorator(${spec.key}): spec.requiredParams must be an array when provided ` +
        `(got ${typeof spec.requiredParams}).`,
    )
  }
  if (
    Array.isArray(spec.requiredParams) &&
    spec.requiredParams.some((p) => typeof p !== 'string' || p.length === 0)
  ) {
    throw new TypeError(
      `defineContextDecorator(${spec.key}): spec.requiredParams entries must be non-empty strings.`,
    )
  }
  if (
    Array.isArray(spec.dependsOn) &&
    spec.dependsOn.some((dep) => typeof dep !== 'string' || dep.length === 0)
  ) {
    // TS narrows dependsOn to `readonly ContextMetaKey[]` for typed
    // adopters, but JS callers (and TS callers who erase via `as any`)
    // can still slip through with `[42]` or `['']`. Surface it at
    // definition time as a TypeError instead of riding to first
    // request as a `MissingContributorError` on a phantom key.
    throw new TypeError(
      `defineContextDecorator(${spec.key}): spec.dependsOn entries must be non-empty strings.`,
    )
  }

  // Source-location capture. `new Error().stack` here records the
  // adopter's call site so boot-time errors (cycles, missing deps,
  // duplicate keys) can point at the file that declared the broken
  // decorator. Bad boot errors are why frameworks get abandoned —
  // a single stack frame turns "what's a 'tenent'?" into "edit
  // src/contributors/tenant.ts line 42".
  const definedAt = new Error().stack

  // Snapshot + freeze paramDefaults so callers can't mutate the spec
  // object post-definition and shift the merged params under our feet.
  // Same immutability boundary applied to `deps` and `dependsOn`.
  const defaults = Object.freeze({
    ...(spec.paramDefaults ?? ({} as Partial<P>)),
  }) as Readonly<Partial<P>>

  // Shared deps + dependsOn — frozen once and reused across every
  // registration produced by this decorator (one per call site).
  // `Object.freeze` is shallow — the values inside (DI tokens,
  // constructors) are intentionally untouched; freezing them would
  // prevent the container from doing legitimate per-instance
  // bookkeeping.
  //
  // The `({} as D)` cast: `spec.deps` is optional (`deps?: D`), so
  // the fallback to `{}` is required. When `D` defaults to
  // `Record<string, never>`, the cast is sound (`{}` matches). When
  // `D` is non-empty AND adopter omitted `deps`, the cast is unsound
  // — but the runner errors loudly the moment it tries to resolve a
  // missing dep, so the mistake surfaces at first request rather
  // than producing wrong-but-silent behaviour. The alternative
  // (forcing `deps` non-optional in the spec) would break ergonomics
  // for the common zero-deps case.
  const sharedDeps = Object.freeze({ ...(spec.deps ?? ({} as D)) }) as D
  const sharedDependsOn = Object.freeze([...(spec.dependsOn ?? [])])
  const sharedOptional = spec.optional ?? false

  /**
   * Build a frozen registration that closes over a specific
   * resolved-params object. The runner sees a normal
   * `(ctx, deps) => value` registration — params are baked into the
   * closure, invisible to the pipeline.
   */
  const buildRegistration = (params: P): ContributorRegistration<K, D, Ctx> => {
    // Shallow-freeze the captured params so a misbehaving `resolve()` /
    // `onError()` can't mutate the closure and bleed into later
    // requests through the same registration. Adopters who really need
    // mutable per-request state should write to `ctx.set(...)` from
    // inside the resolver instead of mutating params.
    const frozenParams = Object.freeze({ ...params }) as P
    const onError: ContributorRegistration<K, D, Ctx>['onError'] = spec.onError
      ? (err: unknown, ctx: Ctx) => spec.onError!(err, ctx, frozenParams)
      : undefined
    const resolve: ContributorRegistration<K, D, Ctx>['resolve'] = (
      ctx: Ctx,
      deps: ResolvedDeps<D>,
    ) => spec.resolve(ctx, deps, frozenParams)
    return Object.freeze({
      key: spec.key,
      deps: sharedDeps,
      dependsOn: sharedDependsOn,
      optional: sharedOptional,
      onError,
      resolve,
      definedAt,
    })
  }

  // Default-params registration — used for zero-arg decorator
  // applications and for the `.registration` accessor. Cloning
  // `defaults` so the closure can't be mutated through the spec.
  const defaultRegistration = buildRegistration({ ...defaults } as P)

  /**
   * Decide whether the decorator was called as a decorator
   * (`@Foo` / `@Foo(target, key)`) or as a factory
   * (`@Foo()` / `@Foo({...})`).
   *
   * - Class decorator: `(target)` where target is a constructor function.
   * - Method decorator: `(target, propertyKey, descriptor?)` where
   *   target is a prototype object and propertyKey is a string/symbol.
   * - Factory (defaults): `()` — adopter wrote `@Foo()` (rare; usually
   *   they write the bare `@Foo`). Returns a decorator using
   *   `paramDefaults`.
   * - Factory (params): `(params)` where params is a plain object.
   *
   * The legacy decorators that ship with KickJS (`@Get('/path')`,
   * `@Cron('* * * *')`, etc.) use the same heuristic, so adopters
   * already know to pass plain object literals as factory args.
   */
  const isDecoratorCall = (args: unknown[]): boolean => {
    // Zero args is a factory call (`@Foo()`), not a direct decorator
    // application — TS never invokes a decorator with zero args.
    if (args.length === 0) return false
    if (args.length >= 2) return true
    const first = args[0]
    // Functions are class constructors at decoration time.
    if (typeof first === 'function') return true
    // Anything else (plain object, undefined, primitive) → factory call.
    return false
  }

  const applyAsDecorator = (
    registration: ContributorRegistration<K, D, Ctx>,
    target: object,
    propertyKey?: string | symbol,
  ): void => {
    if (propertyKey === undefined) {
      // Class decorator — `target` is the constructor.
      pushClassMeta(METADATA.CLASS_CONTRIBUTORS, target, registration)
    } else {
      // Method decorator — `target` is the prototype; we write to its
      // constructor so reads can use the controller class as the
      // lookup key, matching the convention used by @Middleware and
      // consumed by router-builder.ts.
      const constructor = (target as { constructor: object }).constructor
      pushMethodMeta(METADATA.METHOD_CONTRIBUTORS, constructor, String(propertyKey), registration)
    }
  }

  /**
   * `true` for `{...}` and `Object.create(null)`. Rejects every
   * built-in subclass (Map / Set / Date / Error / RegExp / Promise),
   * adopter classes, and arrays.
   */
  const isPlainObject = (value: object): boolean => {
    const proto = Object.getPrototypeOf(value)
    return proto === Object.prototype || proto === null
  }

  /**
   * Merge call-site `Partial<P>` over `paramDefaults`. Strict guard:
   * accepts only **plain object literals** (or `Object.create(null)`).
   * Reject everything else with a descriptive `TypeError`.
   *
   * Why strict? Object spread copies enumerable own properties only.
   * `{ ...new Date() }` and `{ ...new Map([...])}` both produce `{}`
   * — the params silently drop. Catching this at the boundary
   * surfaces the mistake instead of routing the request with empty
   * config. Adopters who genuinely need a class-instance shape can
   * destructure it themselves: `Foo({ ...new MyParams() })`.
   */
  const mergeParams = (override: unknown): P => {
    if (override === undefined) return { ...defaults } as P
    if (
      override === null ||
      typeof override !== 'object' ||
      Array.isArray(override) ||
      !isPlainObject(override)
    ) {
      const got =
        override === null
          ? 'null'
          : Array.isArray(override)
            ? 'array'
            : typeof override === 'object'
              ? `instance of ${(override as object).constructor?.name ?? 'unknown class'}`
              : typeof override
      throw new TypeError(
        `defineContextDecorator(${spec.key}): factory call requires a plain object literal, got ${got}. ` +
          `Class instances and built-ins (Map, Date, etc) silently spread to empty objects — ` +
          `call the decorator with a spread object literal instead, e.g. ` +
          `\`MyDecorator({ ...someInstance })\`.`,
      )
    }
    return { ...defaults, ...(override as Partial<P>) } as P
  }

  const sharedRequiredParams = Object.freeze([...(spec.requiredParams ?? [])])

  /**
   * Runtime half of the required-params guarantee. The type system
   * already stops TS call sites from omitting a required field, so this
   * catches what types can't see: plain-JS adopters, `as any`, and
   * params built dynamically.
   *
   * `usage` names the form that failed so the message points at the fix
   * — a bare `@Foo` on a decorator with required params needs to become
   * `@Foo({ ... })`, which is a different edit from a factory call that
   * merely forgot one field.
   */
  const assertRequiredParams = (params: P, usage: string): void => {
    if (sharedRequiredParams.length === 0) return
    const missing = sharedRequiredParams.filter(
      (name) => (params as Record<string, unknown>)[name] === undefined,
    )
    if (missing.length === 0) return
    throw new TypeError(
      `defineContextDecorator(${spec.key}): ${usage} is missing required param(s) ` +
        `${missing.map((m) => `'${m}'`).join(', ')}. ` +
        `Supply them at the call site — e.g. \`@${spec.key}({ ${missing[0]}: … })\` — or ` +
        `add a default in \`paramDefaults\` if one is genuinely correct for every route.`,
    )
  }

  // Overloaded function signatures so `decoratorOrFactory`'s type
  // matches `ContextDecorator`'s call shapes directly — no
  // `as unknown as` double-cast needed. The implementation signature
  // (`...args: unknown[]`) is hidden from callers; only the four
  // declared overloads are reachable.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  function decoratorOrFactory(target: Function): void
  function decoratorOrFactory(
    target: object,
    propertyKey: string | symbol,
    descriptor?: PropertyDescriptor,
  ): void
  function decoratorOrFactory(): ContextDecoratorTarget
  function decoratorOrFactory(params: Partial<P>): ContextDecoratorTarget
  function decoratorOrFactory(...args: unknown[]): unknown {
    if (isDecoratorCall(args)) {
      const [target, propertyKey] = args as [
        object,
        string | symbol | undefined,
        PropertyDescriptor?,
      ]
      // Bare `@Foo` — nothing can supply params here, so a required one
      // that isn't defaulted is a decoration-time (module-load) failure
      // rather than an undefined riding into the resolver.
      assertRequiredParams({ ...defaults } as P, 'bare `@decorator` usage')
      applyAsDecorator(defaultRegistration, target, propertyKey)
      return undefined
    }
    // Factory call — capture merged params and return a decorator.
    const params = mergeParams(args[0])
    assertRequiredParams(params, 'factory call')
    const registration = buildRegistration(params)
    return (target: object, propertyKey?: string | symbol) => {
      applyAsDecorator(registration, target, propertyKey)
    }
  }

  // Set a meaningful `.name` so `console.log(LoadTenant)` and stack
  // traces show `[Function: ContextDecorator(tenant)]` instead of
  // `[Function: decoratorOrFactory]`. Function.name is configurable
  // by default, so this works on the existing function reference.
  Object.defineProperty(decoratorOrFactory, 'name', {
    value: `ContextDecorator(${spec.key})`,
    writable: false,
    enumerable: false,
    configurable: true,
  })

  // `Object.assign` returns the intersection type, so the decorator
  // gets `.registration` + `.with` properties typed without the
  // previous `as unknown as ContextDecorator<...>` double cast.
  // Properties go on via assign (writable + enumerable defaults),
  // then `Object.freeze` locks the shape so adopters can't mutate
  // `decorator.registration = …` post-construction.
  const decorator = Object.assign(decoratorOrFactory, {
    with: (params: Partial<P>) => {
      const merged = mergeParams(params)
      assertRequiredParams(merged, '`.with()`')
      return { registration: buildRegistration(merged) }
    },
  })

  // `.registration` is a getter, not a plain property, so that reading it
  // on a decorator with undefaulted required params throws instead of
  // handing back a registration whose resolver will see `undefined`.
  // (`Object.assign` would have copied the value and lost the check.)
  Object.defineProperty(decorator, 'registration', {
    get() {
      assertRequiredParams({ ...defaults } as P, '`.registration`')
      return defaultRegistration
    },
    enumerable: true,
    configurable: false,
  })

  // `ContextDecorator` is a conditional type (permissive vs required-params
  // shape), and TS can't evaluate a conditional whose input generics are
  // still unresolved — so the assignment can't be checked structurally
  // here regardless of how `decorator` is built. The cast is the price of
  // the call-site guarantee; the two branches differ only in which call
  // forms they expose, and every one of them is implemented above.
  return Object.freeze(decorator) as unknown as ContextDecorator<K, D, P, Ctx, PD>
}

/**
 * Public export — the positional-generic implementation plus the
 * curried `.withParams<P>()` helper attached as a method. Adopters
 * pick whichever form fits the call site:
 *
 * - **Positional** — `defineContextDecorator(spec)` when there are
 *   no per-call params (the common case). `K`, `D`, `Ctx` infer.
 * - **Curried** — `defineContextDecorator.withParams<P>()(spec)`
 *   when the contributor takes params; spell only `P`, the rest
 *   still infer.
 *
 * Frozen so adopters can't reassign `.withParams` at runtime.
 */
export const defineContextDecorator: DefineContextDecoratorFn = Object.freeze(
  Object.assign(defineContextDecoratorImpl, {
    withParams: <P extends Record<string, unknown>>(): DefineContextDecoratorWithParams<P> => {
      return <
        K extends string,
        D extends Record<string, DepValue> = Record<string, never>,
        Ctx extends ExecutionContext = ExecutionContext,
        PD extends Partial<P> = Record<never, never>,
      >(
        spec: ContextDecoratorSpec<K, D, P, Ctx, PD>,
      ): ContextDecorator<K, D, P, Ctx, PD> => defineContextDecoratorImpl<K, D, P, Ctx, PD>(spec)
    },
  }),
) as DefineContextDecoratorFn
