import type { Request, Response, NextFunction } from 'express'
export declare const REQUEST_ID_HEADER = 'x-request-id'
/** Middleware that generates or propagates a unique request ID */
export declare function requestId(): (req: Request, res: Response, next: NextFunction) => void
//# sourceMappingURL=request-id.d.ts.map
