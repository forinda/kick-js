import type { Request, Response, NextFunction } from 'express'
export interface CsrfOptions {
  /** Cookie name for the CSRF token (default: '_csrf') */
  cookie?: string
  /** Header name to check for the token (default: 'x-csrf-token') */
  header?: string
  /** HTTP methods that require CSRF validation (default: POST, PUT, PATCH, DELETE) */
  methods?: string[]
  /** Paths to exclude from CSRF checks (e.g. webhooks) */
  ignorePaths?: string[]
  /** Token byte length before hex encoding (default: 32 = 64 hex chars) */
  tokenLength?: number
  /** Cookie options */
  cookieOptions?: {
    httpOnly?: boolean
    sameSite?: 'strict' | 'lax' | 'none'
    secure?: boolean
    path?: string
  }
}
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
export declare function csrf(
  options?: CsrfOptions,
): (req: Request, res: Response, next: NextFunction) => void | Response<any, Record<string, any>>
//# sourceMappingURL=csrf.d.ts.map
