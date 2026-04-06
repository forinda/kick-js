import crypto from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'
import { requestStore } from '../request-store'

/**
 * W3C Trace Context header name.
 * @see https://www.w3.org/TR/trace-context/#traceparent-header
 */
export const TRACEPARENT_HEADER = 'traceparent'

/** Regex for a valid W3C traceparent: {version}-{trace-id}-{parent-id}-{flags} */
const TRACEPARENT_RE = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/

export interface TraceContextOptions {
  /**
   * When true, respond with a `traceresponse` header containing the trace ID.
   * Useful for debugging. Default: false.
   */
  propagateResponse?: boolean
}

/**
 * Parsed W3C trace context fields.
 */
export interface TraceContext {
  /** W3C traceparent version (usually '00') */
  version: string
  /** 32-hex-char distributed trace ID */
  traceId: string
  /** 16-hex-char parent span ID */
  parentSpanId: string
  /** 2-hex-char trace flags */
  flags: string
}

/**
 * Generate a random 32-hex-character trace ID.
 */
function generateTraceId(): string {
  return crypto.randomBytes(16).toString('hex')
}

/**
 * Generate a random 16-hex-character span ID.
 */
function generateSpanId(): string {
  return crypto.randomBytes(8).toString('hex')
}

/**
 * Parse a W3C traceparent header value.
 * Returns null if the format is invalid.
 */
export function parseTraceparent(header: string): TraceContext | null {
  const match = TRACEPARENT_RE.exec(header.trim().toLowerCase())
  if (!match) return null

  const version = match[1]
  const traceId = match[2]
  const parentSpanId = match[3]
  const flags = match[4]

  // W3C spec: version ff is invalid, all-zero trace-id and parent-id are invalid
  if (
    version === 'ff' ||
    traceId === '00000000000000000000000000000000' ||
    parentSpanId === '0000000000000000'
  ) {
    return null
  }

  return { version, traceId, parentSpanId, flags }
}

/**
 * Middleware that extracts W3C `traceparent` header and stores trace context
 * in the request's AsyncLocalStorage store.
 *
 * If no valid `traceparent` header is present, a new traceId is generated
 * so that every request always has a trace ID available for correlation.
 *
 * Must be mounted **after** `requestScopeMiddleware()` (which creates the store).
 *
 * @example
 * ```ts
 * bootstrap({
 *   middleware: [
 *     requestScopeMiddleware(),
 *     traceContext(),          // extracts or generates traceId
 *     requestLogger(),
 *     express.json(),
 *   ],
 * })
 * ```
 */
export function traceContext(options: TraceContextOptions = {}) {
  return (req: Request, res: Response, next: NextFunction) => {
    const store = requestStore.getStore()

    const traceparentHeader = req.headers[TRACEPARENT_HEADER]
    const raw = Array.isArray(traceparentHeader) ? traceparentHeader[0] : traceparentHeader
    const parsed = raw ? parseTraceparent(raw) : null

    const traceId = parsed?.traceId ?? generateTraceId()
    const spanId = generateSpanId()

    // Attach to the request store so logger + downstream code can access it
    if (store) {
      store.values.set('traceId', traceId)
      store.values.set('spanId', spanId)
      if (parsed) {
        store.values.set('parentSpanId', parsed.parentSpanId)
        store.values.set('traceFlags', parsed.flags)
        store.values.set('traceVersion', parsed.version)
      }
    }

    // Also expose on req for convenience
    ;(req as any).traceId = traceId
    ;(req as any).spanId = spanId

    if (options.propagateResponse) {
      res.setHeader('traceresponse', traceId)
    }

    next()
  }
}
