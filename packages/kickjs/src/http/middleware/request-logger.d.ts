import type { Request, Response, NextFunction } from 'express';
export interface RequestLoggerOptions {
    /** Logger name (default: 'HTTP') */
    name?: string;
    /** Log level for successful requests (default: 'info') */
    level?: 'info' | 'debug' | 'trace';
    /** Skip logging for paths matching these prefixes (e.g. ['/health', '/_debug']) */
    skip?: string[];
}
/**
 * Middleware that logs every request with method, URL, status, duration, and request ID.
 *
 * @example
 * ```ts
 * bootstrap({
 *   middleware: [requestId(), requestLogger(), express.json()],
 * })
 * ```
 *
 * Output:
 * ```
 * [HTTP] GET /api/v1/users 200 12ms req-abc123
 * [HTTP] POST /api/v1/users 201 45ms req-def456
 * ```
 */
export declare function requestLogger(options?: RequestLoggerOptions): (req: Request, res: Response, next: NextFunction) => void;
//# sourceMappingURL=request-logger.d.ts.map