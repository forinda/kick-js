import type { Request, Response, NextFunction } from 'express'
export interface SessionData {
  [key: string]: unknown
}
export interface SessionStore {
  get(sid: string): Promise<SessionData | null>
  set(sid: string, data: SessionData, maxAge: number): Promise<void>
  destroy(sid: string): Promise<void>
  touch?(sid: string, maxAge: number): Promise<void>
}
export interface Session {
  id: string
  data: SessionData
  regenerate(): Promise<void>
  destroy(): Promise<void>
  save(): Promise<void>
}
export interface SessionOptions {
  /** Secret used to sign the session cookie (required) */
  secret: string
  /** Cookie name (default: 'kick.sid') */
  cookieName?: string
  /** Session max age in milliseconds (default: 86400000 = 24h) */
  maxAge?: number
  /** Reset maxAge on every response (default: false) */
  rolling?: boolean
  /** Save new sessions that have not been modified (default: true) */
  saveUninitialized?: boolean
  /** Cookie options */
  cookie?: {
    httpOnly?: boolean
    secure?: boolean
    sameSite?: 'strict' | 'lax' | 'none'
    path?: string
    domain?: string
  }
  /** Custom session store (default: in-memory store with TTL cleanup) */
  store?: SessionStore
}
/**
 * Session management middleware.
 *
 * Attaches a `req.session` object with `id`, `data`, `regenerate()`,
 * `destroy()`, and `save()` methods. Session IDs are signed with
 * HMAC-SHA256 to prevent cookie tampering.
 *
 * @example
 * ```ts
 * import { session } from '@forinda/kickjs-http'
 *
 * bootstrap({
 *   modules,
 *   middleware: [
 *     cookieParser(),
 *     session({ secret: process.env.SESSION_SECRET! }),
 *     // ... other middleware
 *   ],
 * })
 * ```
 */
export declare function session(
  options: SessionOptions,
): (req: Request, res: Response, next: NextFunction) => Promise<void>
//# sourceMappingURL=session.d.ts.map
