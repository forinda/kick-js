import type { Request, Response, NextFunction } from 'express'

export const REQUEST_ID_HEADER = 'x-request-id'

/**
 * Middleware that generates or propagates a unique request ID.
 *
 * Idempotent: if `req.requestId` is already set (e.g. by
 * `requestScopeMiddleware` earlier in the pipeline), this middleware reuses
 * it instead of generating a divergent second value. Keeps the
 * X-Request-Id response header, the ALS store's `requestId`, and
 * `RequestContext.requestId` in agreement for every request, regardless of
 * mounting order.
 */
export function requestId() {
  return (req: Request, res: Response, next: NextFunction) => {
    const existing = (req as Request & { requestId?: string }).requestId
    // globalThis.crypto (Web Crypto) — portable across node/bun/deno/workers,
    // unlike node:crypto. Node ≥ 19 exposes it globally; engines pin ≥ 20.
    const id = existing || (req.headers[REQUEST_ID_HEADER] as string) || crypto.randomUUID()
    ;(req as any).requestId = id
    res.setHeader(REQUEST_ID_HEADER, id)
    next()
  }
}
