import { randomBytes } from 'node:crypto';
/**
 * Double-submit cookie CSRF protection middleware.
 *
 * On every request, sets a CSRF token cookie. For state-changing methods
 * (POST, PUT, PATCH, DELETE), validates that the request header matches
 * the cookie value.
 *
 * @example
 * ```ts
 * import { csrf } from '@forinda/kickjs-http'
 *
 * bootstrap({
 *   modules,
 *   middleware: [
 *     cookieParser(),
 *     csrf(),
 *     // ... other middleware
 *   ],
 * })
 * ```
 *
 * Client usage:
 * 1. Read the `_csrf` cookie value
 * 2. Send it in the `x-csrf-token` header on every mutating request
 */
export function csrf(options = {}) {
    const cookieName = options.cookie ?? '_csrf';
    const headerName = options.header ?? 'x-csrf-token';
    const protectedMethods = new Set((options.methods ?? ['POST', 'PUT', 'PATCH', 'DELETE']).map((m) => m.toUpperCase()));
    const ignorePaths = new Set(options.ignorePaths ?? []);
    const tokenLength = options.tokenLength ?? 32;
    const cookieOpts = {
        httpOnly: true,
        sameSite: 'strict',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        ...options.cookieOptions,
    };
    return (req, res, next) => {
        // Generate or reuse CSRF token
        const cookies = req.cookies || {};
        let token = cookies[cookieName];
        if (!token) {
            token = randomBytes(tokenLength).toString('hex');
            res.cookie(cookieName, token, cookieOpts);
        }
        // Skip validation for safe methods and ignored paths
        if (!protectedMethods.has(req.method.toUpperCase())) {
            return next();
        }
        if (ignorePaths.has(req.path)) {
            return next();
        }
        // Validate: header token must match cookie token
        const headerToken = req.headers[headerName];
        if (!headerToken || headerToken !== token) {
            return res.status(403).json({
                message: 'CSRF token mismatch',
            });
        }
        next();
    };
}
//# sourceMappingURL=csrf.js.map