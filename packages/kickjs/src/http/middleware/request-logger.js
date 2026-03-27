import { createLogger } from '../../core';
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
export function requestLogger(options = {}) {
    const log = createLogger(options.name ?? 'HTTP');
    const level = options.level ?? 'info';
    const skip = options.skip ?? [];
    return (req, res, next) => {
        // Skip logging for excluded paths
        if (skip.some((prefix) => req.path.startsWith(prefix))) {
            return next();
        }
        const start = Date.now();
        res.on('finish', () => {
            const duration = Date.now() - start;
            const requestId = req.requestId || req.headers['x-request-id'] || '-';
            const status = res.statusCode;
            log[level](`${req.method} ${req.originalUrl} ${status} ${duration}ms ${requestId}`);
        });
        next();
    };
}
//# sourceMappingURL=request-logger.js.map