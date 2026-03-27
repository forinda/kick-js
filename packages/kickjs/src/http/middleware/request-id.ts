import { randomUUID } from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'

export const REQUEST_ID_HEADER = 'x-request-id'

/** Middleware that generates or propagates a unique request ID */
export function requestId() {
  return (req: Request, res: Response, next: NextFunction) => {
    const id = (req.headers[REQUEST_ID_HEADER] as string) || randomUUID()
    // Attach to req as a dedicated property (don't mutate headers)
    ;(req as any).requestId = id
    res.setHeader(REQUEST_ID_HEADER, id)
    next()
  }
}
