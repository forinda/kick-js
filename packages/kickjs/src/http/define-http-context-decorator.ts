/**
 * HTTP-flavoured wrapper around {@link defineContextDecorator}.
 *
 * The core factory leaves `Ctx` defaulted to {@link ExecutionContext} so the
 * Context Contributor pipeline stays transport-agnostic — future WebSocket,
 * queue, and cron contexts share the same primitive. The cost is that the
 * vast majority of contributors (which are HTTP) have to spell the third
 * generic by hand to get `ctx.req` / `ctx.headers` typing:
 *
 * ```ts
 * defineContextDecorator<'tenant', Record<string, never>, RequestContext>({ ... })
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
>(spec: ContextDecoratorSpec<K, D, RequestContext>): ContextDecorator<K, D, RequestContext> {
  return defineContextDecorator<K, D, RequestContext>(spec)
}
