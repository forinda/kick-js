/**
 * HTTP-flavoured wrapper around {@link defineContextDecorator}.
 *
 * The core factory leaves `Ctx` defaulted to {@link ExecutionContext} so the
 * Context Contributor pipeline stays transport-agnostic — future WebSocket,
 * queue, and cron contexts share the same primitive. The cost is that the
 * vast majority of contributors (which are HTTP) have to spell the fourth
 * generic by hand to get `ctx.req` / `ctx.headers` typing:
 *
 * ```ts
 * // Verbose: spell every generic, including the params shape `P`.
 * defineContextDecorator<'tenant', Record<string, never>, Record<string, never>, RequestContext>({
 *   key: 'tenant',
 *   resolve: (ctx) => ({ id: ctx.req.headers['x-tenant-id'] as string }),
 * })
 * ```
 *
 * `defineHttpContextDecorator` removes that ceremony — the spec is typed
 * against `RequestContext` from the start, so resolvers can read `ctx.req`,
 * `ctx.headers`, `ctx.params`, etc. without a cast or generic dance:
 *
 * ```ts
 * import { defineHttpContextDecorator } from '@forinda/kickjs'
 *
 * const LoadTenant = defineHttpContextDecorator({
 *   key: 'tenant',
 *   resolve: (ctx) => ({ id: ctx.req.headers['x-tenant-id'] as string }),
 * })
 *
 * // Parameterised — the positional form forces you to also spell `K`
 * // and `D`, which loses automatic `deps` inference. Prefer the curried
 * // `.withParams<P>()` entry point below.
 * const LoadTenantParameterised = defineHttpContextDecorator<
 *   'tenant',
 *   Record<string, never>,
 *   { source: 'header' | 'subdomain' }
 * >({
 *   key: 'tenant',
 *   paramDefaults: { source: 'header' },
 *   resolve: (ctx, _deps, params) => {
 *     // params.source narrows inside `if` branches.
 *   },
 * })
 *
 * // Parameterised + deps — only `P` is spelled; `K` and `D` infer from
 * // the spec, so `deps.repo` is fully typed in the resolver.
 * const LoadTenantWithRepo = defineHttpContextDecorator.withParams<{
 *   source: 'header' | 'subdomain'
 * }>()({
 *   key: 'tenant',
 *   deps: { repo: TENANT_REPO },
 *   paramDefaults: { source: 'header' },
 *   resolve: (ctx, { repo }, params) =>
 *     repo.findFor(ctx.req.headers['x-tenant-id'] as string, params.source),
 * })
 * ```
 *
 * Use {@link defineContextDecorator} directly when authoring contributors
 * for non-HTTP transports or when you want to share one contributor across
 * HTTP + WS + queue (the resolver then has to stick to the
 * `ExecutionContext` surface — `ctx.get` / `ctx.set` / `ctx.requestId`).
 */

import {
  defineContextDecorator,
  type ContextDecorator,
  type ContextDecoratorSpec,
  type DepValue,
} from '../core/context-decorator'
import type { RequestContext } from './context'

/**
 * Curried form returned by {@link DefineHttpContextDecoratorFn.withParams}.
 * Spell only the per-call params shape `P`; `K` and `D` are inferred
 * from the spec, and `Ctx` is locked to `RequestContext`.
 */
export interface DefineHttpContextDecoratorWithParams<P extends Record<string, unknown>> {
  <K extends string, D extends Record<string, DepValue> = Record<string, never>>(
    spec: ContextDecoratorSpec<K, D, P, RequestContext>,
  ): ContextDecorator<K, D, P, RequestContext>
}

/**
 * Public shape of {@link defineHttpContextDecorator} — the positional
 * call signature plus the curried `.withParams<P>()` helper that fixes
 * partial-inference for the parameterised case.
 */
export interface DefineHttpContextDecoratorFn {
  <
    K extends string,
    D extends Record<string, DepValue> = Record<string, never>,
    P extends Record<string, unknown> = Record<string, never>,
  >(
    spec: ContextDecoratorSpec<K, D, P, RequestContext>,
  ): ContextDecorator<K, D, P, RequestContext>

  /**
   * Curried entry point. Spell only `P`; `K` and `D` infer from the
   * spec. `Ctx` is locked to `RequestContext`.
   *
   * ```ts
   * const LoadTenant = defineHttpContextDecorator.withParams<{
   *   source: 'header' | 'subdomain'
   * }>()({
   *   key: 'tenant',
   *   deps: { repo: TENANT_REPO },           // D inferred
   *   paramDefaults: { source: 'header' },
   *   resolve: (ctx, { repo }, params) => repo.findFor(ctx, params),
   * })
   * ```
   */
  withParams<P extends Record<string, unknown>>(): DefineHttpContextDecoratorWithParams<P>
}

function defineHttpContextDecoratorImpl<
  K extends string,
  D extends Record<string, DepValue> = Record<string, never>,
  P extends Record<string, unknown> = Record<string, never>,
>(spec: ContextDecoratorSpec<K, D, P, RequestContext>): ContextDecorator<K, D, P, RequestContext> {
  return defineContextDecorator<K, D, P, RequestContext>(spec)
}

export const defineHttpContextDecorator: DefineHttpContextDecoratorFn = Object.freeze(
  Object.assign(defineHttpContextDecoratorImpl, {
    withParams: <P extends Record<string, unknown>>(): DefineHttpContextDecoratorWithParams<P> => {
      return <K extends string, D extends Record<string, DepValue> = Record<string, never>>(
        spec: ContextDecoratorSpec<K, D, P, RequestContext>,
      ): ContextDecorator<K, D, P, RequestContext> => defineHttpContextDecoratorImpl<K, D, P>(spec)
    },
  }),
) as DefineHttpContextDecoratorFn
