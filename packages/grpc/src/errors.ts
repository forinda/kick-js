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
 * Normalize anything a handler (or a Context Contributor) threw into a
 * `ConnectError`, which Connect serializes onto the wire for all three
 * protocols.
 *
 * Precedence:
 * 1. An existing `ConnectError` passes through untouched — a handler that
 *    wants an exact code/detail payload stays authoritative.
 * 2. `HttpException` maps by status via {@link codeForStatus}, and its
 *    `headers` become response metadata so `Retry-After` and friends survive.
 * 3. `MissingContextValueError` is `Code.Internal` — a required contributor
 *    not running is a server-side wiring bug, never the caller's fault.
 * 4. Anything else falls to `Code.Internal`, preserving the original as
 *    `cause` for logging without leaking it onto the wire.
 */
export function toConnectError(err: unknown): ConnectError {
  if (err instanceof ConnectError) return err

  if (err instanceof HttpException) {
    return new ConnectError(
      err.message,
      codeForStatus(err.status),
      err.headers,
      undefined,
      err.details,
    )
  }

  if (err instanceof MissingContextValueError) {
    return new ConnectError(err.message, Code.Internal, undefined, undefined, err)
  }

  if (err instanceof Error) {
    return new ConnectError(err.message, Code.Internal, undefined, undefined, err)
  }

  return new ConnectError(String(err), Code.Internal, undefined, undefined, err)
}
