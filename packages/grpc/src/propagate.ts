import { requestStore } from '@forinda/kickjs'
import type { Interceptor } from '@connectrpc/connect'
import type { GrpcContext } from './grpc-context'

/** Request-store key holding the {@link GrpcContext} of the RPC being served. */
export const GRPC_CALL = 'kick:grpc:call'

/**
 * Connect interceptor for clients that call other services from inside a
 * request or an RPC. Each outgoing call carries:
 *
 * - `x-request-id` — the current request's id, so logs line up across services;
 * - `traceparent` — when `traceContext()` ran for the current request;
 * - cancellation — inside an RPC, the outgoing call aborts when the incoming
 *   one does (client cancel or deadline), so no service keeps working for a
 *   caller that has gone.
 *
 * Headers the caller set explicitly win. Outside a request it does nothing.
 *
 * @example
 * ```ts
 * import { createClient } from '@connectrpc/connect'
 * import { createGrpcTransport } from '@connectrpc/connect-node'
 * import { propagateCall } from '@forinda/kickjs-grpc'
 *
 * const users = createClient(
 *   UserService,
 *   createGrpcTransport({ baseUrl: env.USERS_URL, interceptors: [propagateCall] }),
 * )
 * ```
 */
export const propagateCall: Interceptor = (next) => (req) => {
  const store = requestStore.getStore()
  if (!store) return next(req)
  if (!req.header.has('x-request-id')) req.header.set('x-request-id', store.requestId)
  const traceId = store.values.get('traceId')
  const spanId = store.values.get('spanId')
  if (traceId && spanId && !req.header.has('traceparent')) {
    const flags = (store.values.get('traceFlags') as string | undefined) ?? '01'
    req.header.set('traceparent', `00-${traceId}-${spanId}-${flags}`)
  }
  const call = store.values.get(GRPC_CALL) as GrpcContext | undefined
  if (!call) return next(req)
  return next({ ...req, signal: AbortSignal.any([req.signal, call.signal]) } as typeof req)
}
