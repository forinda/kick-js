import { readCookies, sendJson, setCookie } from './respond'
import type {
  ConnectRequest as Request,
  ConnectResponse as Response,
  ConnectNext as NextFunction,
} from '../connect'
import { resolvePathname, type ClientRequestLike } from '../client-ip'

import { randomHex, safeEqual } from '../../core/web-crypto'
import { assertFlagTest, matchesFlagTest, type RouteFlagTest } from '../../core/route-flag'
import type { MiddlewareHandler } from '../../core/decorators'
import type { RequestContext } from '../context'
import { isProduction } from '../../core/is-production'
import { canonicalHost, parseHttpUrl } from '../host'

export interface CsrfOptions {
  /** Cookie name for the CSRF token (default: '_csrf') */
  cookie?: string
  /** Header name to check for the token (default: 'x-csrf-token') */
  header?: string
  /**
   * Form field that carries the token when the header is absent, for plain
   * HTML forms (default: '_csrf'). Read from the parsed body, so `csrf()` must
   * come after the body parser; `csrfGuard()` always runs after it.
   */
  field?: string
  /** HTTP methods that require CSRF validation (default: POST, PUT, PATCH, DELETE) */
  methods?: string[]
  /** Paths to exclude from CSRF checks (e.g. webhooks) */
  ignorePaths?: string[]
  /** Token byte length before hex encoding (default: 32 = 64 hex chars) */
  tokenLength?: number
  /**
   * Origins, besides the request's own host, allowed to send state-changing
   * requests — e.g. `['https://app.example.com']` when the frontend lives on
   * another subdomain. Compared against the `Origin` (or `Referer`) header.
   */
  trustedOrigins?: string[]
  /**
   * Check where an unsafe request came from before the token (default `true`).
   * `Sec-Fetch-Site: same-origin` passes; otherwise the `Origin` (or `Referer`)
   * must match the request's `Host` or a {@link trustedOrigins} entry, and a
   * browser request that says it is cross-site with neither is refused. A
   * request with no such headers at all (a server, curl) goes on to the token
   * check. Turn off only behind a proxy that rewrites `Host` and when you
   * cannot list the origins.
   */
  checkOrigin?: boolean
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

type HeaderBag = Record<string, string | string[] | undefined>

function headerOf(headers: HeaderBag, name: string): string | undefined {
  const value = headers[name]
  return Array.isArray(value) ? value[0] : value
}

/** `scheme://host[:port]` of a URL, or undefined when it doesn't parse. */
function originOfUrl(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    return new URL(url).origin
  } catch {
    return undefined
  }
}

/**
 * Whether an unsafe request came from somewhere allowed to send it — the
 * origin half of CSRF protection, ahead of the token. The token alone (double
 * submit) can be planted by a sibling subdomain that sets cookies on the
 * parent domain; the browser's own origin headers cannot.
 */
export function isAllowedOrigin(headers: HeaderBag, trusted: ReadonlySet<string>): boolean {
  const site = headerOf(headers, 'sec-fetch-site')
  if (site === 'same-origin') return true

  const declared = headerOf(headers, 'origin') ?? originOfUrl(headerOf(headers, 'referer'))
  if (declared === undefined) {
    // No browser origin headers: not a browser cross-site request (or a very
    // old browser). Left to the token. A browser that says cross-site or
    // same-site but sends no origin is refused.
    return site === undefined || site === 'none'
  }
  // `Origin: null` (sandboxed frames, some redirects) and non-http schemes
  // don't parse: refused.
  const origin = parseHttpUrl(declared)
  if (!origin) return false
  if (trusted.has(origin.origin)) return true
  // The scheme is not compared: behind a TLS-terminating proxy the app cannot
  // know it reliably. The host (with port) is what an attacker cannot match.
  // HTTP/2 carries it as `:authority`.
  const host = canonicalHost(
    headerOf(headers, 'host') ?? headerOf(headers, ':authority'),
    origin.protocol,
  )
  return host !== undefined && host === origin.host
}

function trustedSet(origins: string[] | undefined): Set<string> {
  return new Set(
    (origins ?? []).map((o) => {
      const url = parseHttpUrl(o)
      // An origin is scheme + host + port: a path, query or credentials here
      // means the entry was meant as something else.
      if (!url || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
        throw new Error(`csrf: trustedOrigins entry '${o}' is not an http(s) origin`)
      }
      return url.origin
    }),
  )
}

const ORIGIN_REJECTED = { message: 'CSRF origin not allowed' }

/** Where the middleware leaves this request's token, for {@link csrfToken}. */
const TOKEN = Symbol.for('kickjs.csrfToken')

/**
 * This request's CSRF token, for a page to put in its forms
 * (`<input type="hidden" name="_csrf" value="…">`) or a `<meta>` tag. Set by
 * `csrf()` or `csrfGuard()`, including on the first visit, before the
 * browser has the cookie. `undefined` when neither ran.
 */
export function csrfToken(ctx: { req: unknown } | undefined): string | undefined {
  return (ctx?.req as { [TOKEN]?: string } | undefined)?.[TOKEN]
}

/**
 * A cookie value shaped like a token this middleware issues. Anything else
 * (set by a sibling subdomain, or by hand) is replaced, so {@link csrfToken}
 * only ever hands a page hex.
 */
function isOwnToken(value: string | undefined, bytes: number): value is string {
  return value !== undefined && value.length === bytes * 2 && /^[0-9a-f]+$/.test(value)
}

/** The token a mutating request sent: the header, else the form field. */
function sentToken(headers: HeaderBag, body: unknown, header: string, field: string) {
  const fromHeader = headers[header]
  if (typeof fromHeader === 'string') return fromHeader
  const fromBody =
    body && typeof body === 'object' ? (body as Record<string, unknown>)[field] : undefined
  return typeof fromBody === 'string' ? fromBody : undefined
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
  const fieldName = options.field ?? '_csrf'
  const protectedMethods = new Set(
    (options.methods ?? ['POST', 'PUT', 'PATCH', 'DELETE']).map((m) => m.toUpperCase()),
  )
  const ignorePaths = new Set(options.ignorePaths ?? [])
  const tokenLength = options.tokenLength ?? 32
  const checkOrigin = options.checkOrigin ?? true
  const trusted = trustedSet(options.trustedOrigins)
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
    secure: isProduction(),
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

    if (!isOwnToken(token, tokenLength)) {
      token = randomHex(tokenLength)
      setCookie(res, cookieName, token, cookieOpts)
    }
    ;(req as { [TOKEN]?: string })[TOKEN] = token

    // Skip validation for safe methods and ignored paths
    if (!protectedMethods.has(req.method.toUpperCase())) {
      return next()
    }

    // `req.path` is Express-only, so `has(undefined)` never matched and
    // configured exemptions were silently ignored on Fastify / h3.
    if (ignorePaths.has(resolvePathname(req as ClientRequestLike))) {
      return next()
    }

    if (checkOrigin && !isAllowedOrigin(req.headers as HeaderBag, trusted)) {
      return sendJson(res, 403, ORIGIN_REJECTED)
    }

    // Validate: the header (or form field) token must match the cookie token
    const sent = sentToken(
      req.headers as HeaderBag,
      (req as { body?: unknown }).body,
      headerName,
      fieldName,
    )

    if (sent === undefined || !safeEqual(sent, token)) {
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
  const fieldName = options.field ?? '_csrf'
  const protectedMethods = new Set(
    (options.methods ?? ['POST', 'PUT', 'PATCH', 'DELETE']).map((m) => m.toUpperCase()),
  )
  const ignorePaths = new Set(options.ignorePaths ?? [])
  const tokenLength = options.tokenLength ?? 32
  const exemptWhen = options.exemptWhen
  if (exemptWhen !== undefined) assertFlagTest(exemptWhen, 'csrfGuard({ exemptWhen })')
  const checkOrigin = options.checkOrigin ?? true
  const trusted = trustedSet(options.trustedOrigins)
  const cookieOpts = {
    // Same default as `csrf()` above, and for the same reason.
    httpOnly: false,
    sameSite: 'strict' as const,
    secure: isProduction(),
    path: '/',
    ...options.cookieOptions,
  }

  return (ctx: RequestContext, next: () => void): void => {
    const cookies = readCookies(ctx.req)
    let token = cookies[cookieName]

    if (!isOwnToken(token, tokenLength)) {
      token = randomHex(tokenLength)
      setCookie(ctx.res, cookieName, token, cookieOpts)
    }
    ;(ctx.req as { [TOKEN]?: string })[TOKEN] = token

    // Safe methods only ever issue the token.
    const method = ctx.route?.method ?? (ctx.req as { method?: string }).method ?? 'GET'
    if (!protectedMethods.has(method.toUpperCase())) return next()

    // Flag first: it is the declared exemption, and cheaper than the path set.
    if (exemptWhen !== undefined && matchesFlagTest(exemptWhen, ctx.route?.flags, ctx.route)) {
      return next()
    }

    if (ignorePaths.has(resolvePathname(ctx.req as unknown as ClientRequestLike))) return next()

    if (checkOrigin && !isAllowedOrigin(ctx.headers as HeaderBag, trusted)) {
      ctx.json(ORIGIN_REJECTED, 403)
      return
    }

    const sent = sentToken(ctx.headers as HeaderBag, ctx.req.body, headerName, fieldName)
    if (sent === undefined || !safeEqual(sent, token)) {
      ctx.json({ message: 'CSRF token mismatch' }, 403)
      return
    }

    next()
  }
}
