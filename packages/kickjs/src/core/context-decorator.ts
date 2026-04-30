import 'reflect-metadata'
import { METADATA, type Constructor, type MaybePromise } from './interfaces'
import { pushClassMeta, pushMethodMeta } from './metadata'
import type { InjectionToken } from './token'
import type { ContextMeta, ExecutionContext, MetaValue } from './execution-context'

/**
 * String-literal union of every key declared on the augmentable
 * {@link ContextMeta} interface. Resolves to `string` when the
 * project hasn't augmented `ContextMeta` yet (so a first-day project
 * keeps compiling), and narrows to the concrete keys once the
 * `declare module '@forinda/kickjs' { interface ContextMeta { ... } }`
 * blocks land.
 *
 * Used as the element type of `dependsOn`, so a typo like
 * `dependsOn: ['tenent']` becomes a TS error instead of a boot-time
 * `MissingContributorError`.
 */
export type ContextMetaKey = keyof ContextMeta extends never ? string : keyof ContextMeta & string

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
 * Spec passed to {@link defineContextDecorator}. Describes one entry in
 * the per-request contributor pipeline.
 *
 * @typeParam K   - The {@link ContextMeta} key this contributor populates.
 * @typeParam D   - DI dependency declaration shape (see {@link ResolvedDeps}).
 * @typeParam Ctx - Concrete execution-context type. Defaults to the abstract
 *                  {@link ExecutionContext}; HTTP contributors typically
 *                  default to `RequestContext` at the call site.
 */
export interface ContextDecoratorSpec<
  K extends string = string,
  D extends Record<string, DepValue> = Record<string, never>,
  P = Record<string, never>,
  Ctx extends ExecutionContext = ExecutionContext,
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
   * Typed against `keyof ContextMeta` once the project augments it — so
   * `dependsOn: ['tenent']` (typo) is a TS error, not a boot-time
   * `MissingContributorError`. Falls back to plain `string[]` when the
   * registry is empty (no augmentation yet) so first-day projects keep
   * compiling. Cast-as-any escape hatch:
   * `dependsOn: ['custom-key' as keyof ContextMeta]`.
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
   * **Required-field caveat.** The factory call signature accepts
   * `Partial<P>` so adopters can override only the fields they care
   * about. If your `P` declares a *required* field that isn't in
   * `paramDefaults`, the merged runtime value can be missing that
   * field even though TypeScript types `params` as `P` inside
   * `resolve()`. Mitigate by either:
   *
   * 1. Marking the field optional in `P` and `if`-checking inside
   *    `resolve()`, or
   * 2. Providing a default for every required field in
   *    `paramDefaults`.
   *
   * The framework can't enforce option 2 at compile time without
   * giving up the back-compat that lets `paramDefaults` be omitted
   * entirely for `P = Record<string, never>`.
   */
  paramDefaults?: Partial<P>
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
 * The value returned by {@link defineContextDecorator}. Callable as either
 * a method or class decorator, and exposes the underlying frozen
 * {@link ContributorRegistration} via `.registration` for non-decorator
 * registration sites (module hooks, adapter hooks, bootstrap option).
 */
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

export interface ContextDecorator<
  K extends string = string,
  D extends Record<string, DepValue> = Record<string, never>,
  P = Record<string, never>,
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
 * **No runtime behaviour is wired in Phase 1.** This factory only writes
 * metadata; the topo-sort, runner, and HTTP integration land in later
 * phases. See `architecture.md` §20 for the full pipeline plan.
 */
export function defineContextDecorator<
  K extends string,
  D extends Record<string, DepValue> = Record<string, never>,
  P = Record<string, never>,
  Ctx extends ExecutionContext = ExecutionContext,
>(spec: ContextDecoratorSpec<K, D, P, Ctx>): ContextDecorator<K, D, P, Ctx> {
  const defaults = (spec.paramDefaults ?? {}) as Partial<P>

  // Shared deps + dependsOn — frozen once and reused across every
  // registration produced by this decorator (one per call site).
  // `Object.freeze` is shallow — the values inside (DI tokens,
  // constructors) are intentionally untouched; freezing them would
  // prevent the container from doing legitimate per-instance
  // bookkeeping.
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
    const onError: ContributorRegistration<K, D, Ctx>['onError'] = spec.onError
      ? (err: unknown, ctx: Ctx) => spec.onError!(err, ctx, params)
      : undefined
    const resolve: ContributorRegistration<K, D, Ctx>['resolve'] = (
      ctx: Ctx,
      deps: ResolvedDeps<D>,
    ) => spec.resolve(ctx, deps, params)
    return Object.freeze({
      key: spec.key,
      deps: sharedDeps,
      dependsOn: sharedDependsOn,
      optional: sharedOptional,
      onError,
      resolve,
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
   * Merge call-site `Partial<P>` over `paramDefaults`. Guards against
   * `@Foo(null)` / `@Foo(undefined)` from JS callers (TS would catch
   * these via `Partial<P>`); we throw a descriptive error rather than
   * letting `{...null}` confuse TC39 and produce silent garbage.
   * Arrays are also rejected — they're objects, but a params array
   * is almost never what the adopter meant.
   */
  const mergeParams = (override: unknown): P => {
    if (override === undefined) return { ...defaults } as P
    if (override === null || typeof override !== 'object' || Array.isArray(override)) {
      throw new TypeError(
        `defineContextDecorator(${spec.key}): factory call requires a plain object literal, ` +
          `got ${override === null ? 'null' : Array.isArray(override) ? 'array' : typeof override}`,
      )
    }
    return { ...defaults, ...(override as Partial<P>) } as P
  }

  function decoratorOrFactory(...args: unknown[]): unknown {
    if (isDecoratorCall(args)) {
      const [target, propertyKey] = args as [
        object,
        string | symbol | undefined,
        PropertyDescriptor?,
      ]
      applyAsDecorator(defaultRegistration, target, propertyKey)
      return undefined
    }
    // Factory call — capture merged params and return a decorator.
    const params = mergeParams(args[0])
    const registration = buildRegistration(params)
    return (target: object, propertyKey?: string | symbol) => {
      applyAsDecorator(registration, target, propertyKey)
    }
  }

  Object.defineProperty(decoratorOrFactory, 'registration', {
    value: defaultRegistration,
    writable: false,
    enumerable: true,
    configurable: false,
  })

  Object.defineProperty(decoratorOrFactory, 'with', {
    value: (params: Partial<P>) => ({
      registration: buildRegistration(mergeParams(params)),
    }),
    writable: false,
    enumerable: true,
    configurable: false,
  })

  return decoratorOrFactory as unknown as ContextDecorator<K, D, P, Ctx>
}
