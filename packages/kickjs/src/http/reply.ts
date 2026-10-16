// Return-value handler support.
//
// Handlers may RETURN their response payload instead of calling `ctx.json`:
// the runtime auto-sends it when the pipeline finishes with nothing written.
// `reply(status, body)` wraps a payload with a non-200 status while staying
// transparent to type inference (`Reply<201, Task>` carries both statically).
//
// Edge-safe: no node imports — shared by all four runtimes including the
// `@forinda/kickjs/web` entry.

import type { RequestContext } from './context'
import type { RuntimeResponse } from './runtime'

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
  /** Response headers set before the body is sent. */
  readonly headers?: ReplyHeaders
}

/** Header name → value, as `ctx.setHeader` takes them. */
export type ReplyHeaders = Readonly<Record<string, string | number | readonly string[]>>

/** Options for {@link reply}. */
export interface ReplyOptions {
  /** Response headers set before the body is sent. */
  headers?: ReplyHeaders
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
 *
 * `options.headers` are set on the response before it is sent:
 * `reply(202, job, { headers: { 'Retry-After': 5 } })`.
 */
export function reply<S extends number, T>(
  status: S,
  body: T,
  options?: ReplyOptions,
): Reply<S, T> {
  return options?.headers
    ? { [REPLY_BRAND]: true, status, body, headers: options.headers }
    : { [REPLY_BRAND]: true, status, body }
}

/** `reply(200, body)` — explicit form of a bare `return body`. */
reply.ok = <T>(body: T): Reply<200, T> => reply(200, body)
/**
 * `reply(201, body)`. `location` sets the `Location` header — where the new
 * resource lives, usually built with `ctx.urlFor()`:
 *
 * ```ts
 * const task = await this.tasks.create(ctx.body)
 * return reply.created(task, { location: ctx.urlFor('TaskController.getById', { id: task.id }) })
 * ```
 */
reply.created = <T>(body: T, options?: ReplyOptions & { location?: string }): Reply<201, T> =>
  reply(
    201,
    body,
    options?.location === undefined
      ? options
      : { headers: { ...options.headers, Location: options.location } },
  )
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

type UnwrapReply<A> =
  A extends Reply<number, infer B>
    ? B
    : A extends RuntimeResponse
      ? // The engine's own response object says nothing about the body, so a
        // handler ending `return ctx.json(...)` degrades to `unknown` — which is
        // what the typegen comment always claimed happened. It did not: the bare
        // `RuntimeResponse` leaked into `KickRoutes[...].response`, offering
        // `.status()` / `.setHeader()` to a client expecting a payload.
        // Confidently wrong is worse than unknown.
        //
        // To carry a payload, return it (`return user`) or wrap it
        // (`return reply(201, user)`) — that is what `reply` is for.
        unknown
      : A

export function isReply(value: unknown): value is Reply {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<symbol, unknown>)[REPLY_BRAND] === true
  )
}

/**
 * Key of the method a self-sending result carries. A returned value with
 * `[RESPOND](ctx)` writes its own response — how an integration (an Inertia
 * page, a rendered view) works as a return value without the framework
 * knowing its format. Registry symbol, so a second copy of the package still
 * matches.
 */
export const RESPOND: unique symbol = Symbol.for('kickjs.respond') as never

/** A handler return value that writes its own response. */
export interface Respondable {
  [RESPOND](ctx: RequestContext): void | PromiseLike<void>
}

export function isRespondable(value: unknown): value is Respondable {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<symbol, unknown>)[RESPOND] === 'function'
  )
}

/**
 * Send a handler's RETURN value when the pipeline finished without anything
 * having written a response. Callers guard on "driver/response unsettled" —
 * this only decides how to send:
 *
 * - `undefined` → not handled (returns false; runtime keeps today's behavior)
 * - `Respondable` → its `[RESPOND](ctx)` writes the response (may be async)
 * - `Reply` wrapper → status + body (204 → `ctx.noContent()`)
 * - anything else → `ctx.json(value)` (200)
 *
 * Returns true when a response was produced — a promise of it for an async
 * `Respondable`, which callers await so its errors reach the error handler.
 */
export function applyHandlerResult(
  ctx: RequestContext,
  result: unknown,
): boolean | Promise<boolean> {
  if (result === undefined) return false
  if (isRespondable(result)) {
    const sent: unknown = result[RESPOND](ctx)
    // Any thenable, not `instanceof Promise` — a promise from another realm
    // (a VM context, an iframe-like runtime) fails that check.
    return typeof (sent as PromiseLike<void> | undefined)?.then === 'function'
      ? Promise.resolve(sent).then(() => true)
      : true
  }
  if (isReply(result)) {
    if (result.headers) {
      for (const [name, value] of Object.entries(result.headers)) ctx.setHeader(name, value)
    }
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
