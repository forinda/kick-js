import 'reflect-metadata'
import { METADATA, type Constructor, type MaybePromise } from './interfaces'
import { pushClassMeta, pushMethodMeta } from './metadata'
import type { InjectionToken } from './token'
import type { ExecutionContext, MetaValue } from './execution-context'

/**
 * Maps a `deps` declaration object to its resolved-instance shape.
 *
 * `deps: { db: DB_TOKEN, cache: CacheService }` produces
 * `{ db: Db, cache: CacheService }` — the runner resolves each value
 * against the DI container and hands the result to `resolve()`.
 */
export type ResolvedDeps<D extends Record<string, unknown>> = {
  [K in keyof D]: D[K] extends InjectionToken<infer T>
    ? T
    : D[K] extends Constructor<infer T>
      ? T
      : unknown
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
  D extends Record<string, unknown> = Record<string, never>,
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
   */
  dependsOn?: readonly string[]
  /**
   * If `true`, a thrown `resolve` skips the contributor instead of
   * forwarding to the request error handler. The key is left unset
   * and downstream consumers see `ctx.get(key) === undefined`.
   */
  optional?: boolean
  /**
   * Hook invoked when `resolve()` throws and `optional` is `false`.
   * Returning a value writes it to `ctx.set(key, …)`; returning
   * `undefined` / `void` skips. Throwing inside the hook forwards
   * the new error to the request error handler.
   *
   * Async-permitted by design — adopters frequently want to
   * `await auditService.log(err)` or `await cache.fallback(...)`.
   */
  onError?: (err: unknown, ctx: Ctx) => MaybePromise<MetaValue<K> | undefined | void>
  /** Compute and return the value to write into `ctx.set(key, …)`. */
  resolve: (ctx: Ctx, deps: ResolvedDeps<D>) => MaybePromise<MetaValue<K>>
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
  D extends Record<string, unknown> = Record<string, never>,
  Ctx extends ExecutionContext = ExecutionContext,
> {
  readonly key: K
  readonly deps: D
  readonly dependsOn: readonly string[]
  readonly optional: boolean
  readonly onError?: ContextDecoratorSpec<K, D, Ctx>['onError']
  readonly resolve: ContextDecoratorSpec<K, D, Ctx>['resolve']
}

/**
 * The value returned by {@link defineContextDecorator}. Callable as either
 * a method or class decorator, and exposes the underlying frozen
 * {@link ContributorRegistration} via `.registration` for non-decorator
 * registration sites (module hooks, adapter hooks, bootstrap option).
 */
export interface ContextDecorator<
  K extends string = string,
  D extends Record<string, unknown> = Record<string, never>,
  Ctx extends ExecutionContext = ExecutionContext,
> {
  (target: object, propertyKey?: string | symbol, descriptor?: PropertyDescriptor): void
  readonly registration: ContributorRegistration<K, D, Ctx>
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
  D extends Record<string, unknown> = Record<string, never>,
  Ctx extends ExecutionContext = ExecutionContext,
>(spec: ContextDecoratorSpec<K, D, Ctx>): ContextDecorator<K, D, Ctx> {
  const registration: ContributorRegistration<K, D, Ctx> = Object.freeze({
    key: spec.key,
    deps: spec.deps ?? ({} as D),
    dependsOn: Object.freeze([...(spec.dependsOn ?? [])]),
    optional: spec.optional ?? false,
    onError: spec.onError,
    resolve: spec.resolve,
  })

  function decorator(
    target: object,
    propertyKey?: string | symbol,
    _descriptor?: PropertyDescriptor,
  ): void {
    if (propertyKey === undefined) {
      // Class decorator — `target` is the constructor.
      pushClassMeta(METADATA.CLASS_CONTRIBUTORS, target, registration)
    } else {
      // Method decorator — `target` is the prototype; we write to its
      // constructor so reads can use the controller class as the lookup
      // key, matching the convention used by @Middleware and consumed by
      // router-builder.ts.
      const constructor = (target as { constructor: object }).constructor
      pushMethodMeta(METADATA.METHOD_CONTRIBUTORS, constructor, String(propertyKey), registration)
    }
  }

  Object.defineProperty(decorator, 'registration', {
    value: registration,
    writable: false,
    enumerable: true,
    configurable: false,
  })

  return decorator as ContextDecorator<K, D, Ctx>
}
