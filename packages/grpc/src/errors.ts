import { HttpException, MissingContextValueError } from '@forinda/kickjs'
import { Code, ConnectError } from '@connectrpc/connect'

/**
 * HTTP status → Connect/gRPC status code. Follows the mapping the gRPC
 * gateway and grpc-gateway projects use, so a service that throws KickJS's
 * `HttpException` from shared domain code produces the status a gRPC client
 * expects without the handler restating it.
 */
const STATUS_TO_CODE: Record<number, Code> = {
  400: Code.InvalidArgument,
  401: Code.Unauthenticated,
  403: Code.PermissionDenied,
  404: Code.NotFound,
  405: Code.Unimplemented,
  408: Code.DeadlineExceeded,
  409: Code.AlreadyExists,
  412: Code.FailedPrecondition,
  413: Code.ResourceExhausted,
  416: Code.OutOfRange,
  422: Code.InvalidArgument,
  429: Code.ResourceExhausted,
  // 499 is nginx's "client closed request"; gRPC's canonical Canceled.
  499: Code.Canceled,
  500: Code.Internal,
  501: Code.Unimplemented,
  503: Code.Unavailable,
  504: Code.DeadlineExceeded,
}

/** Map an HTTP status to a Connect code, defaulting by status class. */
export function codeForStatus(status: number): Code {
  const mapped = STATUS_TO_CODE[status]
  if (mapped !== undefined) return mapped
  if (status >= 500) return Code.Internal
  if (status >= 400) return Code.Unknown
  return Code.Unknown
}

/**
 * Wire message used for every `Code.Internal` response this module produces.
 *
 * Deliberately opaque. An unexpected throw is a server-side fault the caller
 * can do nothing about, and its `message` routinely carries details that must
 * not cross a trust boundary — SQL fragments, absolute paths, connection
 * strings, upstream hostnames. The original error is preserved on `cause` for
 * server-side logging, which is where it belongs.
 */
export const INTERNAL_ERROR_MESSAGE = 'Internal error'

/**
 * Normalize anything a handler (or a Context Contributor) threw into a
 * `ConnectError`, which Connect serializes onto the wire for all three
 * protocols.
 *
 * Precedence:
 * 1. An existing `ConnectError` passes through untouched — a handler that
 *    wants an exact code/message/detail payload stays authoritative.
 * 2. `HttpException` maps by status via {@link codeForStatus}, and its
 *    `headers` become response metadata so `Retry-After` and friends survive.
 *    Its message **is** sent: raising one is a deliberate act of describing a
 *    fault to the caller, exactly as it would be over HTTP.
 * 3. Everything else — `MissingContextValueError`, any other `Error`, and
 *    non-`Error` throws — becomes `Code.Internal` with the opaque
 *    {@link INTERNAL_ERROR_MESSAGE}. The original is kept on `cause` so the
 *    adapter can log it server-side; it never reaches the client.
 *
 * Need the real message on the wire for a specific failure? Throw a
 * `ConnectError` (rule 1) or an `HttpException` (rule 2), or map it yourself
 * through `GrpcAdapter({ onError })` — all three are explicit decisions to
 * disclose, which is the point.
 */
export function toConnectError(err: unknown): ConnectError {
  if (err instanceof ConnectError) return err

  if (err instanceof HttpException) {
    // `cause` carries the original exception (including its `details`
    // payload) for logging. Connect's 4th parameter takes protobuf
    // `OutgoingDetail`s, which arbitrary JSON details cannot satisfy.
    return new ConnectError(err.message, codeForStatus(err.status), err.headers, undefined, err)
  }

  if (err instanceof MissingContextValueError) {
    return new ConnectError(INTERNAL_ERROR_MESSAGE, Code.Internal, undefined, undefined, err)
  }

  return new ConnectError(INTERNAL_ERROR_MESSAGE, Code.Internal, undefined, undefined, err)
}
