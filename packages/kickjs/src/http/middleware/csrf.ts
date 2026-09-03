import { readCookies, sendJson, setCookie } from './respond'
import type { Request, Response, NextFunction } from 'express'
import { resolvePathname, type ClientRequestLike } from '../client-ip'

import { randomHex } from '../../core/web-crypto'
import { matchesFlagTest, type RouteFlagTest } from '../../core/route-flag'
import type { MiddlewareHandler } from '../../core/decorators'
import type { RequestContext } from '../context'

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
    /**
     * Default `false`, because double-submit CSRF needs the page to read the
     * token and echo it in a header. Set `true` only if the client receives
     * the token another way — server-rendered, or from your own endpoint.
     */
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
 *   middlewares: [
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
    // `false`, not `true`: double-submit CSRF requires the PAGE to read this
    // cookie and echo it in a header. Under `httpOnly: true` `document.cookie`
    // returns nothing, no header is sent, and every mutating request answers
    // 403 — the documented client flow could not work. The token is not a
    // credential; a token an attacker cannot read is also one your own page
    // cannot send. Set `cookieOptions: { httpOnly: true }` only when the token
    // reaches the client some other way (server-rendered, or your own endpoint).
    httpOnly: false,
    sameSite: 'strict' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    ...options.cookieOptions,
  }

  return (req: Request, res: Response, next: NextFunction) => {
    // Generate or reuse CSRF token
    // NOT `req.cookies` alone: that is populated only by an upstream parser,
    // which Fastify and h3 never have and Express only has if the app mounts
    // one. Without this the middleware never saw the token it had just issued.
    const cookies = readCookies(req)
    let token = cookies[cookieName]

    if (!token) {
      token = randomHex(tokenLength)
      setCookie(res, cookieName, token, cookieOpts)
    }

    // Skip validation for safe methods and ignored paths
    if (!protectedMethods.has(req.method.toUpperCase())) {
      return next()
    }

    // `req.path` is Express-only, so `has(undefined)` never matched and
    // configured exemptions were silently ignored on Fastify / h3.
    if (ignorePaths.has(resolvePathname(req as ClientRequestLike))) {
      return next()
    }

    // Validate: header token must match cookie token
    const headerToken = req.headers[headerName] as string | undefined

    if (!headerToken || headerToken !== token) {
      return sendJson(res, 403, {
        message: 'CSRF token mismatch',
      })
    }

    next()
  }
}

export interface CsrfGuardOptions extends CsrfOptions {
  /**
   * Skip the token check on routes carrying a route flag — a name, a list of
   * names (any-of), or a predicate.
   *
   * This is the reason the guard exists. `csrf()` runs before route matching,
   * so its only handle on "not this endpoint" is {@link CsrfOptions.ignorePaths}
   * — an exact pathname string that cannot express `/webhooks/:provider` and
   * keeps parsing after an `apiPrefix` change that voids it. A flag is declared
   * on the route itself:
   *
   * ```ts
   * const CsrfExempt = defineRouteFlag('csrf.exempt')
   *
   * @CsrfExempt
   * @Controller()
   * class WebhooksController {
   *   @Post('/:provider') receive(ctx: RequestContext) {}
   * }
   * ```
   */
  exemptWhen?: RouteFlagTest
}

/**
 * Double-submit cookie CSRF protection as a `(ctx, next)` middleware.
 *
 * The ctx-style counterpart of {@link csrf}: it runs inside the matched route,
 * so it can read `ctx.route.flags` and be exempted per route, and it works on
 * every runtime including the `@forinda/kickjs/web` fetch entry.
 *
 * ```ts
 * // per controller — the flag-aware form
 * @Middleware(csrfGuard({ exemptWhen: 'csrf.exempt' }))
 * @Controller()
 * class BillingController {}
 *
 * // edge, app-wide
 * createWebApp({ h3, modules, middleware: [csrfGuard()] })
 * ```
 *
 * Mount `csrf()` instead when you want one app-wide connect middleware that
 * also covers requests matching no route — nothing to exempt, nothing to read.
 */
export function csrfGuard(options: CsrfGuardOptions = {}): MiddlewareHandler {
  const cookieName = options.cookie ?? '_csrf'
  const headerName = options.header ?? 'x-csrf-token'
  const protectedMethods = new Set(
    (options.methods ?? ['POST', 'PUT', 'PATCH', 'DELETE']).map((m) => m.toUpperCase()),
  )
  const ignorePaths = new Set(options.ignorePaths ?? [])
  const tokenLength = options.tokenLength ?? 32
  const exemptWhen = options.exemptWhen
  const cookieOpts = {
    // Same default as `csrf()` above, and for the same reason.
    httpOnly: false,
    sameSite: 'strict' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    ...options.cookieOptions,
  }

  return (ctx: RequestContext, next: () => void): void => {
    const cookies = readCookies(ctx.req)
    let token = cookies[cookieName]

    if (!token) {
      token = randomHex(tokenLength)
      setCookie(ctx.res, cookieName, token, cookieOpts)
    }

    // Safe methods only ever issue the token.
    const method = ctx.route?.method ?? (ctx.req as { method?: string }).method ?? 'GET'
    if (!protectedMethods.has(method.toUpperCase())) return next()

    // Flag first: it is the declared exemption, and cheaper than the path set.
    if (exemptWhen !== undefined && matchesFlagTest(exemptWhen, ctx.route?.flags, ctx.route)) {
      return next()
    }

    if (ignorePaths.has(resolvePathname(ctx.req as unknown as ClientRequestLike))) return next()

    const headerToken = ctx.headers[headerName] as string | undefined
    if (!headerToken || headerToken !== token) {
      ctx.json({ message: 'CSRF token mismatch' }, 403)
      return
    }

    next()
  }
}
