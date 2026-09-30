/**
 * `diagnostics_channel` publishing for the Node server — how APM agents,
 * OpenTelemetry instrumentations and the DevTools subscribe without being an
 * adapter or plugin. Every channel is free when nobody subscribes: each
 * publish is guarded by `hasSubscribers`.
 *
 * | Channel | Kind | Payload |
 * | --- | --- | --- |
 * | `kickjs:handler` | tracing channel (`start` / `end` / `asyncStart` / `asyncEnd` / `error`) | {@link HandlerTraceContext} |
 * | `kickjs:error` | channel | `{ error, ...ErrorInfo }` |
 * | `kickjs:response` | channel | `ResponseInfo` |
 *
 * `kickjs:handler` wraps the controller method itself, so a span started on
 * `start` covers the handler and follows its async work.
 *
 * Node-only (imported by the Application, never by the web entry).
 *
 * @module @forinda/kickjs/http/tracing
 */
import diagnostics from 'node:diagnostics_channel'
import { setObserverPublisher, type ErrorInfo, type ResponseInfo } from '../core/observers'
import type { CtxHandler } from './runtime'
import type { RequestContext } from './context'

export const HANDLER_CHANNEL = 'kickjs:handler'
export const ERROR_CHANNEL = 'kickjs:error'
export const RESPONSE_CHANNEL = 'kickjs:response'

/** What subscribers to `kickjs:handler` receive. */
export interface HandlerTraceContext {
  method: string
  /** The route pattern, e.g. `/api/v1/users/:id` — the span name APMs want. */
  route: string
  controller?: string
  handler?: string
  requestId?: string
  ctx: RequestContext
}

const handlerChannel = diagnostics.tracingChannel<HandlerTraceContext>(HANDLER_CHANNEL)
const errorChannel = diagnostics.channel(ERROR_CHANNEL)
const responseChannel = diagnostics.channel(RESPONSE_CHANNEL)

/** Feed the error / response channels from the observer funnel. Idempotent. */
export function installChannelPublisher(): void {
  setObserverPublisher(
    {
      name: 'diagnostics_channel',
      onError(error: unknown, info: ErrorInfo) {
        if (errorChannel.hasSubscribers) errorChannel.publish({ error, ...info })
      },
      onResponse(info: ResponseInfo) {
        if (responseChannel.hasSubscribers) responseChannel.publish(info)
      },
    },
    () => responseChannel.hasSubscribers,
  )
}

/**
 * Wrap a route's terminal handler in the `kickjs:handler` tracing channel.
 * With no subscriber the original handler runs untouched (same return value,
 * sync or async).
 */
export function traceHandler(
  handler: CtxHandler,
  meta: Omit<HandlerTraceContext, 'ctx' | 'requestId'>,
): CtxHandler {
  return (ctx) => {
    if (!handlerChannel.hasSubscribers) return handler(ctx)
    return handlerChannel.tracePromise(async () => handler(ctx), {
      ...meta,
      requestId: ctx.requestId,
      ctx,
    })
  }
}
