/**
 * Work that outlives the response — `waitUntil(promise)`.
 *
 * A handler that fires off an audit log, an email, or an analytics call and
 * answers without awaiting it leaves that promise unowned: on serverless the
 * platform freezes or kills the instance once the response is sent, and on a
 * Node server `SIGTERM` exits before it settles. `waitUntil` registers the
 * promise so something waits for it:
 *
 * - on the Node server, `shutdown()` awaits it (within `shutdownTimeout`);
 * - through `createHandler()` and the web entry, it is handed to the
 *   platform's own `waitUntil` (Workers `ctx`, Netlify `context`, Vercel's
 *   `waitUntil`) when you pass it in.
 *
 * Process-wide, like the DI container: one app per process.
 *
 * @module @forinda/kickjs/http/background
 */
import { createLogger } from '../core/logger'
import { requestStore } from './request-store'

const log = createLogger('waitUntil')
const pending = new Set<Promise<void>>()

/**
 * Keep `promise` alive past the response. A rejection is logged (with the
 * request id when called during a request), never left unhandled.
 *
 * @example
 * ```ts
 * @Post('/')
 * async create(ctx: RequestContext) {
 *   const order = await this.orders.create(ctx.body)
 *   ctx.waitUntil(this.mailer.sendReceipt(order)) // or waitUntil(...) outside a handler
 *   return order
 * }
 * ```
 */
export function waitUntil(promise: Promise<unknown>): void {
  const requestId = requestStore.getStore()?.requestId
  const tracked: Promise<void> = Promise.resolve(promise).then(
    () => {},
    (err: unknown) => {
      log.error({ err, requestId }, 'Background work passed to waitUntil() failed')
    },
  )
  pending.add(tracked)
  void tracked.finally(() => pending.delete(tracked))
}

/**
 * Resolve once every registered promise has settled — including work
 * registered while waiting. Never rejects.
 */
export async function settleBackgroundWork(): Promise<void> {
  while (pending.size > 0) await Promise.all(pending)
}

/** How many `waitUntil` promises have not settled yet. */
export function pendingBackgroundWork(): number {
  return pending.size
}

/**
 * The platform hook `createHandler()` and the web entry forward background
 * work to. Cloudflare Workers' `ctx`, Netlify's `context`, and `{ waitUntil }`
 * from `@vercel/functions` all have this shape.
 */
export interface PlatformContext {
  waitUntil?(promise: Promise<unknown>): void
}

/** Hand every pending (and later-registered) promise to the platform. */
export function forwardBackgroundWork(platform: PlatformContext | undefined): void {
  platform?.waitUntil?.(settleBackgroundWork())
}
