// Return-value handler support (response-inference-design.md §3.1).
//
// Handlers may RETURN their response payload instead of calling `ctx.json`:
// the runtime auto-sends it when the pipeline finishes with nothing written.
// `reply(status, body)` wraps a payload with a non-200 status while staying
// transparent to type inference (`Reply<201, Task>` carries both statically).
//
// Edge-safe: no node imports — shared by all four runtimes including the
// `@forinda/kickjs/web` entry.

import type { RequestContext } from './context'

// `Symbol.for` so the brand survives duplicate module copies (workspace-linked
// + published package in one process — same rationale as the request-scope
// middleware marker).
const REPLY_BRAND = Symbol.for('kickjs.reply')

/**
 * A status-carrying response payload for return-value handlers. Create via
 * {@link reply} — the brand is what runtimes detect, and the generics are
 * what the `kick/routes` response typegen unwraps (`Reply<S, T>` → `T`).
 */
export interface Reply<S extends number = number, T = unknown> {
  readonly [REPLY_BRAND]: true
  readonly status: S
  readonly body: T
}

/**
 * Wrap a return-value handler's payload with an explicit status code:
 *
 * ```ts
 * @Post('/')
 * async create(ctx: RequestContext) {
 *   return reply(201, await this.tasks.create(ctx.body))
 * }
 * ```
 */
export function reply<S extends number, T>(status: S, body: T): Reply<S, T> {
  return { [REPLY_BRAND]: true, status, body }
}

/** `reply(201, body)` */
reply.created = <T>(body: T): Reply<201, T> => reply(201, body)
/** `reply(202, body)` */
reply.accepted = <T>(body: T): Reply<202, T> => reply(202, body)
/** Empty 204 — maps to `ctx.noContent()`. */
reply.noContent = (): Reply<204, undefined> => reply(204, undefined)

/**
 * The statically-inferred response type of a controller handler — what
 * `kick typegen` emits into `KickRoutes[...].response`:
 *
 * - `Awaited<ReturnType>` of the method
 * - `Reply<S, T>` unwraps to `T`
 * - `void`/`undefined` members are dropped (imperative `ctx.json` branches);
 *   a handler that never returns a value stays `unknown`, matching the
 *   pre-inference emission
 *
 * ```ts
 * type R = InferHandlerResponse<UsersController['get']> // → User
 * ```
 */
export type InferHandlerResponse<H> = H extends (...args: never[]) => infer R
  ? [Exclude<Awaited<R>, void | undefined>] extends [never]
    ? unknown
    : UnwrapReply<Exclude<Awaited<R>, void | undefined>>
  : unknown

type UnwrapReply<A> = A extends Reply<number, infer B> ? B : A

export function isReply(value: unknown): value is Reply {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<symbol, unknown>)[REPLY_BRAND] === true
  )
}

/**
 * Send a handler's RETURN value when the pipeline finished without anything
 * having written a response. Callers guard on "driver/response unsettled" —
 * this only decides how to send:
 *
 * - `undefined` → not handled (returns false; runtime keeps today's behavior)
 * - `Reply` wrapper → status + body (204 → `ctx.noContent()`)
 * - anything else → `ctx.json(value)` (200)
 *
 * Returns true when a response was produced.
 */
export function applyHandlerResult(ctx: RequestContext, result: unknown): boolean {
  if (result === undefined) return false
  if (isReply(result)) {
    // Only 204 maps to noContent — an undefined body must NOT coerce the
    // declared status (reply(304, undefined) keeps its 304; the json body
    // is simply empty).
    if (result.status === 204) {
      ctx.noContent()
      return true
    }
    ctx.json(result.body, result.status)
    return true
  }
  ctx.json(result)
  return true
}
