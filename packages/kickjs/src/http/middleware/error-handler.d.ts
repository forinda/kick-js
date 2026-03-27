import type { Request, Response, NextFunction } from 'express'
/** Catch-all for unmatched routes */
export declare function notFoundHandler(): (
  _req: Request,
  res: Response,
  _next: NextFunction,
) => void
/** Global error handler */
export declare function errorHandler(): (
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction,
) => Response<any, Record<string, any>> | undefined
//# sourceMappingURL=error-handler.d.ts.map
