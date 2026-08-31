import type { Request, Response, NextFunction } from 'express'

/** Brand identifying a `helmet()` handler, so auto-injection can stand down. */
export const HELMET_MIDDLEWARE = Symbol.for('kick/http/helmet')

export interface HelmetOptions {
  /** Set Content-Security-Policy header (default: self-only policy) */
  contentSecurityPolicy?: boolean | Record<string, string[]>
  /** Set X-Content-Type-Options: nosniff (default: true) */
  noSniff?: boolean
  /** Set X-Frame-Options (default: 'DENY') */
  frameguard?: false | 'DENY' | 'SAMEORIGIN'
  /** Set Strict-Transport-Security (default: max-age=31536000; includeSubDomains) */
  hsts?: false | { maxAge?: number; includeSubDomains?: boolean; preload?: boolean }
  /** Set X-DNS-Prefetch-Control (default: off) */
  dnsPrefetch?: boolean
  /** Remove X-Powered-By header (default: true) */
  hidePoweredBy?: boolean
  /** Set Referrer-Policy (default: 'no-referrer') */
  referrerPolicy?: false | string
  /** Set X-XSS-Protection: 0 (default: true — disables legacy XSS auditor) */
  xssFilter?: boolean
}

/**
 * Security headers middleware. Lightweight alternative to the `helmet` npm package
 * with sensible defaults for API servers.
 *
 * @example
 * ```ts
 * bootstrap({
 *   middlewares: [helmet(), requestId(), express.json()],
 * })
 * ```
 */
export function helmet(options: HelmetOptions = {}) {
  const {
    noSniff = true,
    frameguard = 'DENY',
    hsts = { maxAge: 31536000, includeSubDomains: true },
    dnsPrefetch = false,
    hidePoweredBy = true,
    referrerPolicy = 'no-referrer',
    xssFilter = true,
    contentSecurityPolicy = false,
  } = options

  const handler = (req: Request, res: Response, next: NextFunction) => {
    if (hidePoweredBy) res.removeHeader('X-Powered-By')
    if (noSniff) res.setHeader('X-Content-Type-Options', 'nosniff')
    if (frameguard) res.setHeader('X-Frame-Options', frameguard)
    if (xssFilter) res.setHeader('X-XSS-Protection', '0')
    if (referrerPolicy) res.setHeader('Referrer-Policy', referrerPolicy)
    if (!dnsPrefetch) res.setHeader('X-DNS-Prefetch-Control', 'off')

    if (hsts) {
      const maxAge = hsts.maxAge ?? 31536000
      let value = `max-age=${maxAge}`
      if (hsts.includeSubDomains) value += '; includeSubDomains'
      if (hsts.preload) value += '; preload'
      res.setHeader('Strict-Transport-Security', value)
    }

    if (contentSecurityPolicy) {
      const policy =
        typeof contentSecurityPolicy === 'object'
          ? Object.entries(contentSecurityPolicy)
              .map(([key, values]) => `${key} ${values.join(' ')}`)
              .join('; ')
          : "default-src 'self'"
      res.setHeader('Content-Security-Policy', policy)
    }

    next()
  }

  // Brand the handler so the Application skips its own auto-injection. Without
  // that, auto-helmet runs first with defaults and a user helmet can only ADD
  // headers — an explicit `frameguard: false` would leave the auto-injected
  // `X-Frame-Options: DENY` standing.
  return Object.defineProperty(handler, HELMET_MIDDLEWARE, { value: true })
}
