import { randomUUID } from 'node:crypto'
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
    const id = existing || (req.headers[REQUEST_ID_HEADER] as string) || randomUUID()
    ;(req as any).requestId = id
    res.setHeader(REQUEST_ID_HEADER, id)
    next()
  }
}
