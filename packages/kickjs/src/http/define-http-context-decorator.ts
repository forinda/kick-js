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
 * // Parameterised: the third generic carries the per-call params shape.
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

export function defineHttpContextDecorator<
  K extends string,
  D extends Record<string, DepValue> = Record<string, never>,
  P extends Record<string, unknown> = Record<string, never>,
>(spec: ContextDecoratorSpec<K, D, P, RequestContext>): ContextDecorator<K, D, P, RequestContext> {
  return defineContextDecorator<K, D, P, RequestContext>(spec)
}
