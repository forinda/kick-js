import crypto from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'
import { requestStore, type RequestStore } from '../request-store'

/**
 * Wraps each request in an AsyncLocalStorage context.
 * Enables REQUEST-scoped DI and automatic requestId propagation to logs.
 *
 * Should be mounted early in the middleware pipeline (before route handlers).
 */
export function requestScopeMiddleware() {
  return (req: Request, _res: Response, next: NextFunction) => {
    const requestIdHeader = req.headers['x-request-id']
    const requestId =
      (Array.isArray(requestIdHeader) ? requestIdHeader[0] : requestIdHeader) || crypto.randomUUID()
    const store: RequestStore = {
      requestId,
      instances: new Map(),
      values: new Map(),
    }
    requestStore.run(store, () => next())
  }
}
