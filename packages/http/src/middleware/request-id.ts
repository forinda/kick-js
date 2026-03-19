import { randomUUID } from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'

export const REQUEST_ID_HEADER = 'x-request-id'

/** Middleware that generates or propagates a unique request ID */
export function requestId() {
  return (req: Request, res: Response, next: NextFunction) => {
    const id = (req.headers[REQUEST_ID_HEADER] as string) || randomUUID()
    req.headers[REQUEST_ID_HEADER] = id
    res.setHeader(REQUEST_ID_HEADER, id)
    next()
  }
}
