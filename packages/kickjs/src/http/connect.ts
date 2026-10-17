/**
 * Connect-style middleware types, owned here rather than borrowed from Express:
 * the `(req, res, next)` shape runs on every runtime (Express natively, Fastify
 * through `@fastify/middie`, h3 through its node adapter), so its types can't
 * need `express` installed.
 *
 * Express middleware still fits: `express.json()`, `cors()`, or a handler typed
 * with Express's `Request` / `Response` is accepted wherever these are.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * The request a connect middleware sees: Node's `IncomingMessage`, plus the
 * members Express adds. Those are optional — under Fastify and h3 a member
 * Express adds may be missing, unless a middleware before it set it.
 */
export interface ConnectRequest extends IncomingMessage {
  /** Always set on a request a server received. */
  method: string
  url: string
  body?: any
  query?: any
  params?: any
  path?: string
  originalUrl?: string
  ip?: string
  hostname?: string
  cookies?: Record<string, string>
  /** Whatever earlier middleware attached: `file`, `files`, `session`, `user`, … */
  [key: string]: any
}

/** The response a connect middleware sees: Node's `ServerResponse`, plus what an engine adds. */
export interface ConnectResponse extends ServerResponse {
  [key: string]: any
}

/** Call to continue; pass an error to skip to the error handlers. */
export type ConnectNext = (err?: any) => void

// Declared as methods so parameters compare both ways: a handler written for
// Express's richer `Request` / `Response` is still accepted.
type Bivariant<F extends (...args: any[]) => unknown> = {
  fn(...args: Parameters<F>): unknown
}['fn']

/** `(req, res, next)` middleware. */
export type ConnectHandler = Bivariant<
  (req: ConnectRequest, res: ConnectResponse, next: ConnectNext) => unknown
>

/** `(err, req, res, next)` error middleware. */
export type ConnectErrorHandler = Bivariant<
  (err: any, req: ConnectRequest, res: ConnectResponse, next: ConnectNext) => unknown
>

/** Either kind of connect middleware. */
export type ConnectMiddleware = ConnectHandler | ConnectErrorHandler
