import { randomBytes } from 'node:crypto'
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
 * import { csrf } from '@forinda/kickjs'
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
export function csrf(options: CsrfOptions = {}) {
  const cookieName = options.cookie ?? '_csrf'
  const headerName = options.header ?? 'x-csrf-token'
  const protectedMethods = new Set(
    (options.methods ?? ['POST', 'PUT', 'PATCH', 'DELETE']).map((m) => m.toUpperCase()),
  )
  const ignorePaths = new Set(options.ignorePaths ?? [])
  const tokenLength = options.tokenLength ?? 32
  const cookieOpts = {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    ...options.cookieOptions,
  }

  return (req: Request, res: Response, next: NextFunction) => {
    // Generate or reuse CSRF token
    const cookies = (req as any).cookies || {}
    let token = cookies[cookieName]

    if (!token) {
      token = randomBytes(tokenLength).toString('hex')
      res.cookie(cookieName, token, cookieOpts)
    }

    // Skip validation for safe methods and ignored paths
    if (!protectedMethods.has(req.method.toUpperCase())) {
      return next()
    }

    if (ignorePaths.has(req.path)) {
      return next()
    }

    // Validate: header token must match cookie token
    const headerToken = req.headers[headerName] as string | undefined

    if (!headerToken || headerToken !== token) {
      return res.status(403).json({
        message: 'CSRF token mismatch',
      })
    }

    next()
  }
}
