import type { Request, Response, NextFunction } from 'express'
export interface HelmetOptions {
  /** Set Content-Security-Policy header (default: self-only policy) */
  contentSecurityPolicy?: boolean | Record<string, string[]>
  /** Set X-Content-Type-Options: nosniff (default: true) */
  noSniff?: boolean
  /** Set X-Frame-Options (default: 'DENY') */
  frameguard?: false | 'DENY' | 'SAMEORIGIN'
  /** Set Strict-Transport-Security (default: max-age=31536000; includeSubDomains) */
  hsts?:
    | false
    | {
        maxAge?: number
        includeSubDomains?: boolean
        preload?: boolean
      }
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
 *   middleware: [helmet(), requestId(), express.json()],
 * })
 * ```
 */
export declare function helmet(
  options?: HelmetOptions,
): (req: Request, res: Response, next: NextFunction) => void
//# sourceMappingURL=helmet.d.ts.map
