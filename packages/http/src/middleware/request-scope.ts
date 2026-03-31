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
    const store: RequestStore = {
      requestId: (req.headers['x-request-id'] as string) || crypto.randomUUID(),
      instances: new Map(),
      values: new Map(),
    }
    requestStore.run(store, () => next())
  }
}
