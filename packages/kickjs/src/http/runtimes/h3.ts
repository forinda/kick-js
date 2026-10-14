// The h3 runtime — `@forinda/kickjs/h3`.
//
// Targets h3 v2: the web-standard line where `event.req` is a WHATWG Request,
// handlers return values/Responses, and `app.fetch(request)` is the universal
// entry. h3 v1 is not supported; loading it fails fast with upgrade guidance.
//
// The request pipeline runs through the shared web driver pair
// (`../web/driver`, `../web/handler`) — the same code path the
// `@forinda/kickjs/web` edge entry uses, so node bootstrap and edge deploys
// exercise identical request semantics.
//
// Unmatched requests: behind a node host that passed `next` (`kick dev`'s
// Vite server, `app.handle(req, res, next)`), they are handed back to it
// like the Fastify runtime does, unless `notFoundFallthrough: false`;
// everywhere else kick's notFound handler answers them.

import type { IncomingMessage, ServerResponse } from 'node:http'
import { createRequire } from 'node:module'

import type {
  ConnectMiddleware,
  HttpRuntime,
  RouteTable,
  RuntimeAppOptions,
  UseConnectOptions,
} from '../runtime'
import { compileWebRoute, readThrough, type WebRouteHooks } from '../web/handler'
import { WebRequestShim, WebResponseDriver } from '../web/driver'
import { createLogger, describeError } from '../../core/logger'

const log = createLogger('H3Runtime')

const peerRequire = createRequire(import.meta.url)

const NOTFOUND_MW = Symbol('kickjs.h3web.notFoundMw')
const ERROR_MW = Symbol('kickjs.h3web.errorMw')
const ASSEMBLED = Symbol('kickjs.h3web.assembled')
const NOOP_NEXT = (): void => {}
/** The host's `next`, stashed on the node request by `nodeHandler`. */
const NEXT = Symbol('kickjs.h3web.next')
/** `notFoundFallthrough: false` — answer unmatched requests instead of handing them back. */
const NO_FALLTHROUGH = Symbol('kickjs.h3web.noFallthrough')
const TRUST_PROXY = Symbol('kickjs.h3.trustProxy')
/** h3 v2's "the node response was handled elsewhere" return value. */
const H3_HANDLED = Symbol.for('h3.handled')

// Minimal structural surface of h3 v2 we depend on.
interface H3AppLike {
  on(method: string, path: string, handler: (event: H3EventLike) => unknown): unknown
  all(path: string, handler: (event: H3EventLike) => unknown): unknown
  use(...args: unknown[]): unknown
  fetch(request: Request): Promise<Response>
}
interface H3EventLike {
  req: Request & { runtime?: { node?: { req: IncomingMessage; res: ServerResponse } } }
  url: URL
  context: { params?: Record<string, string> }
}

interface H3v2Module {
  H3: new (config?: unknown) => H3AppLike
  toNodeHandler: (app: H3AppLike) => (req: IncomingMessage, res: ServerResponse) => void
  fromNodeHandler: (mw: unknown) => unknown
}

export interface H3RuntimeOptions {
  /**
   * Pre-imported h3 module, for when the app's `h3` is not the one this
   * package resolves (a linked checkout, a bundler):
   * `h3Runtime({ h3: await import('h3') })`.
   * Omitted → the installed `h3` peer.
   */
  h3?: unknown
}

/** An h3 module as `import()` or `require()` hands it over, ESM interop unwrapped. */
function unwrapH3Module(mod: unknown): Record<string, unknown> {
  const m = mod as { __esModule?: boolean; default?: Record<string, unknown> } & Record<
    string,
    unknown
  >
  return m && m.__esModule && m.default ? { ...m.default, ...m } : m
}

/** Resolve h3 (injected or peer-required) and fail fast unless it is v2. */
function loadH3v2(injected?: unknown): H3v2Module {
  const resolved = unwrapH3Module(injected ?? peerRequire('h3')) as unknown as H3v2Module
  if (typeof resolved.H3 !== 'function') {
    throw new Error(
      '@forinda/kickjs: h3Runtime() requires h3 v2, but the installed h3 has no H3 class — that is the v1 line, ' +
        'which this version of KickJS no longer supports. Upgrade: `pnpm add h3@^2`.',
    )
  }
  return resolved
}

/**
 * Bridge a connect-style terminal middleware (kick's notFound / error
 * handlers) onto the web driver pair, returning the produced Response.
 */
async function runConnectTerminal(
  mw: ConnectMiddleware | undefined,
  event: H3EventLike,
  err?: unknown,
): Promise<Response> {
  const shim = new WebRequestShim(event.req, event.url)
  // What the app's connect middleware set (session, an adapter's slot) is
  // visible to the error / not-found handler, as on the route itself.
  const carry = event.req.runtime?.node?.req ?? FETCH_CONNECT.get(event)?.req
  const req = carry ? readThrough(shim, carry) : shim
  const driver = new WebResponseDriver(event.req.signal)
  if (mw) {
    const returned =
      err !== undefined
        ? (mw as (e: unknown, rq: unknown, rs: unknown, n: () => void) => unknown)(
            err,
            req,
            driver,
            NOOP_NEXT,
          )
        : (mw as (rq: unknown, rs: unknown, n: () => void) => unknown)(req, driver, NOOP_NEXT)
    // An async handler answers after an await: wait for it before deciding
    // nothing answered. One that rejects is an error in its own right.
    if (typeof (returned as PromiseLike<void> | undefined)?.then === 'function') {
      try {
        await returned
      } catch (handlerErr) {
        if (!driver.settled) {
          log.error(
            handlerErr,
            `h3: the ${err !== undefined ? 'error' : 'not-found'} handler failed`,
          )
          driver.status(500).json({ error: 'Internal Server Error' })
        }
      }
    }
  }
  if (!driver.settled) {
    if (err !== undefined) {
      // The configured error handler ran but didn't settle the response
      // (or there wasn't one). Emitting a bare 500 with no log entry
      // makes this failure invisible on both sides — log it here, since
      // by definition nothing downstream will.
      log.error(err, `h3: error handler did not settle the response — ${describeError(err)}`)
      driver.status(500).json({
        error: 'Internal Server Error',
        ...(typeof process !== 'undefined' && process.env?.NODE_ENV === 'production'
          ? {}
          : { message: describeError(err) }),
      })
    } else {
      driver.status(404).json({ error: 'Not Found' })
    }
  }
  return driver.ready
}

// ── Connect middleware on the fetch path ─────────────────────────────────
//
// `app.fetch(request)` (edge, Bun, Deno, a serverless function) carries no
// node req/res, and h3's `fromNodeHandler` throws without one. Connect
// middleware there runs against the web driver pair instead: one request shim
// per event (so `req.requestId` set by one middleware is seen by the next) and
// one header bag per event that is merged into whatever Response comes back.
// The merge is ours rather than h3's `event.res.headers` because h3 skips
// prepared headers on non-2xx responses, and a 404/422/500 must still carry
// helmet's headers and the request id, exactly as on node.

interface FetchConnectState {
  req: WebRequestShim
  headers: Headers
}

const FETCH_CONNECT = new WeakMap<object, FetchConnectState>()

function fetchConnectState(event: H3EventLike): FetchConnectState {
  let state = FETCH_CONNECT.get(event)
  if (!state) {
    state = { req: new WebRequestShim(event.req, event.url), headers: new Headers() }
    FETCH_CONNECT.set(event, state)
  }
  return state
}

/**
 * Add the headers connect middleware set to `response`. The response's own
 * headers win — a later `setHeader` overrides an earlier one on node too.
 * Consumed once, so every middleware layer can call it on the way out.
 */
function withConnectHeaders(event: H3EventLike, response: Response): Response {
  const state = FETCH_CONNECT.get(event)
  if (!state) return response
  const missing = [...state.headers].filter(
    ([name]) => name === 'set-cookie' || !response.headers.has(name),
  )
  state.headers = new Headers()
  if (missing.length === 0) return response
  try {
    for (const [name, value] of missing) response.headers.append(name, value)
    return response
  } catch {
    // Immutable headers (a Response from fetch) — rebuild around the body.
    const headers = new Headers(response.headers)
    for (const [name, value] of missing) headers.append(name, value)
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }
}

/**
 * The node `res` surface connect middleware uses, over the web driver:
 * headers go to the per-event bag, `statusCode`, and `finish`/`close`
 * emitted once the response exists.
 */
class FetchConnectResponse extends WebResponseDriver {
  private code = 200
  private listeners: Array<[string, (...args: unknown[]) => void]> = []

  constructor(
    private readonly prepared: Headers,
    signal: AbortSignal,
  ) {
    super(signal)
  }

  get statusCode(): number {
    return this.code
  }

  set statusCode(code: number) {
    this.status(code)
  }

  override status(code: number): this {
    this.code = code
    return super.status(code)
  }

  override writeHead(code: number, headers?: Record<string, string | number | string[]>): this {
    this.code = code
    return super.writeHead(code, headers)
  }

  override setHeader(name: string, value: unknown): this {
    if (Array.isArray(value)) {
      this.prepared.delete(name)
      for (const v of value) this.prepared.append(name, String(v))
    } else {
      this.prepared.set(name, String(value))
    }
    return this
  }

  getHeader(name: string): string | undefined {
    return this.prepared.get(name) ?? undefined
  }

  hasHeader(name: string): boolean {
    return this.prepared.has(name)
  }

  removeHeader(name: string): void {
    this.prepared.delete(name)
  }

  override once(event: string, listener: (...args: unknown[]) => void): this {
    this.listeners.push([event, listener])
    return this
  }

  on(event: string, listener: (...args: unknown[]) => void): this {
    return this.once(event, listener)
  }

  removeListener(event: string, listener: (...args: unknown[]) => void): this {
    this.listeners = this.listeners.filter(([e, l]) => e !== event || l !== listener)
    return this
  }

  off(event: string, listener: (...args: unknown[]) => void): this {
    return this.removeListener(event, listener)
  }

  /**
   * The response exists (or the request failed): fire `finish` then `close`.
   * Runs before `withConnectHeaders` merges this response's headers into the
   * route's, so a `finish` listener can still set one — the cookie session
   * store writes its cookie there.
   */
  done(): void {
    for (const event of ['finish', 'close']) {
      for (const [e, listener] of this.listeners) if (e === event) listener()
      this.listeners = this.listeners.filter(([e]) => e !== event)
    }
  }
}

function runConnectOnFetch(
  mw: ConnectMiddleware,
  event: H3EventLike,
  next: () => unknown,
): Promise<unknown> {
  const state = fetchConnectState(event)
  const res = new FetchConnectResponse(state.headers, event.req.signal)

  return new Promise((resolve, reject) => {
    const respond = (response: Response): void => {
      res.done()
      resolve(withConnectHeaders(event, response))
    }
    const fail = (err: unknown): void => {
      res.done()
      reject(err)
    }

    // The middleware answered itself (`res.end`, `res.json`, `writeHead`).
    void res.ready.then(respond)

    const connectNext = (err?: unknown): void => {
      if (err) return fail(err)
      if (res.settled) return
      // The route builds its request store from the inbound header; hand it the
      // id requestScope/requestId settled on so body, logs and header agree.
      const id = state.req.requestId
      if (id && event.req.headers.get('x-request-id') !== id) {
        try {
          event.req.headers.set('x-request-id', id)
        } catch {
          // Immutable request headers on some runtimes — the route mints its own id.
        }
      }
      let downstream: unknown
      try {
        // Synchronous, so downstream work starts inside any AsyncLocalStorage
        // scope this middleware opened (requestScopeMiddleware).
        downstream = next()
      } catch (e) {
        return fail(e)
      }
      Promise.resolve(downstream).then((value) => {
        if (value instanceof Response) return respond(value)
        res.done()
        resolve(value)
      }, fail)
    }

    try {
      ;(mw as (rq: unknown, rs: unknown, n: (err?: unknown) => void) => void)(
        state.req,
        res,
        connectNext,
      )
    } catch (err) {
      fail(err)
    }
  })
}

/**
 * Terminal catch-all AFTER all mounted routes: kick's own notFound handler
 * answers unmatched paths (h3 v2's default 404 never fires). rou3 ranks `/**`
 * below every concrete route, so registration time does not matter.
 */
function assembleCatchAll(app: H3AppLike): void {
  const state = app as unknown as Record<symbol, unknown>
  if (state[ASSEMBLED]) return
  state[ASSEMBLED] = true
  app.all('/**', (event: H3EventLike) => {
    const node = event.req.runtime?.node
    const next = (node?.req as (IncomingMessage & { [NEXT]?: () => void }) | undefined)?.[NEXT]
    if (node && next && !state[NO_FALLTHROUGH]) {
      // Hand the request back to the host and tell h3 the node response is
      // taken care of; srvx then leaves the already-written response alone.
      return new Promise((resolve) => {
        const done = () => resolve(H3_HANDLED)
        node.res.once('finish', done)
        node.res.once('close', done)
        next()
      })
    }
    const mw = state[NOTFOUND_MW] as ConnectMiddleware | undefined
    return runConnectTerminal(mw, event)
  })
}

type ProxyTrust = (address: string, hop: number) => boolean

/**
 * The `trustProxy` forms h3 can honour without an address-matching library:
 * `true` (every hop), a hop count, or a predicate — Express's semantics for
 * each. Address and subnet lists are not supported here; they are refused
 * with a warning and the socket address is kept, so a misread rule never
 * trusts a header it should not.
 */
function proxyTrust(option: RuntimeAppOptions['trustProxy']): ProxyTrust | undefined {
  if (option === undefined || option === false) return undefined
  if (option === true) return () => true
  if (typeof option === 'number') return (_address, hop) => hop < option
  if (typeof option === 'function') return option
  log.warn(
    'h3: trustProxy as an address or subnet list is not supported; client IPs ' +
      'use the socket address. Use a hop count or a function instead.',
  )
  return undefined
}

/**
 * Express's `proxy-addr` walk: from the socket outward through
 * `x-forwarded-for`, stop at the first address the rule does not trust.
 */
function forwardedClientIp(req: IncomingMessage, trust: ProxyTrust): string | undefined {
  const socket = req.socket?.remoteAddress
  if (!socket) return undefined
  const header = req.headers['x-forwarded-for']
  const forwarded = (Array.isArray(header) ? header.join(',') : (header ?? ''))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .toReversed()
  const chain = [socket, ...forwarded]
  for (let hop = 0; hop < chain.length - 1; hop++) {
    if (!trust(chain[hop]!, hop)) return chain[hop]
  }
  return chain[chain.length - 1]
}

/**
 * A middleware mounted at a path sees `req.url` relative to that path, as on
 * Express — `serve-static` mounted at `/files` must look up
 * `/nested/a.txt`, not `/files/nested/a.txt`. h3 v2 leaves the URL whole, so
 * strip the prefix for the call and restore it when the middleware passes on.
 * `req.originalUrl` keeps the full URL, as Express sets it.
 */
function stripMountPrefix(path: string, mw: ConnectMiddleware): ConnectMiddleware {
  const prefix = path.endsWith('/') ? path.slice(0, -1) : path
  if (prefix === '') return mw
  return ((
    req: IncomingMessage & { originalUrl?: string },
    res: unknown,
    next: (err?: unknown) => void,
  ) => {
    const url = req.url ?? '/'
    const rest = url.startsWith(prefix) ? url.slice(prefix.length) : null
    if (rest === null || (rest !== '' && rest[0] !== '/' && rest[0] !== '?')) {
      return (mw as (rq: unknown, rs: unknown, n: (err?: unknown) => void) => unknown)(
        req,
        res,
        next,
      )
    }
    req.originalUrl ??= url
    req.url = rest.startsWith('/') ? rest : `/${rest}`
    return (mw as (rq: unknown, rs: unknown, n: (err?: unknown) => void) => unknown)(
      req,
      res,
      (err?: unknown) => {
        req.url = url
        next(err)
      },
    )
  }) as unknown as ConnectMiddleware
}

/**
 * The h3 HTTP runtime. Pass to `bootstrap({ runtime: h3Runtime() })`.
 * Requires the h3 v2 peer; fails fast with guidance when v1 is installed.
 */
export function h3Runtime(options: H3RuntimeOptions = {}): HttpRuntime<H3AppLike> {
  const { H3, toNodeHandler, fromNodeHandler } = loadH3v2(options.h3)

  return {
    name: 'h3',

    createApp(options: RuntimeAppOptions = {}): H3AppLike {
      const holder: { app?: H3AppLike } = {}
      const app = new H3({
        // Engine-level errors (middleware throws outside the kick pipeline)
        // dispatch to the kick error handler once setErrorHandler stashes it.
        onError: (error: unknown, event: H3EventLike) => {
          const mw = (holder.app as unknown as Record<symbol, ConnectMiddleware | undefined>)?.[
            ERROR_MW
          ]
          return runConnectTerminal(mw, event, error).then((response) =>
            withConnectHeaders(event, response),
          )
        },
      })
      holder.app = app
      ;(app as unknown as Record<symbol, unknown>)[NO_FALLTHROUGH] =
        options.notFoundFallthrough === false
      ;(app as unknown as Record<symbol, unknown>)[TRUST_PROXY] = proxyTrust(options.trustProxy)
      return app
    },

    nodeHandler(app) {
      assembleCatchAll(app)
      const listener = toNodeHandler(app)
      const trust = (app as unknown as Record<symbol, unknown>)[TRUST_PROXY] as
        | ProxyTrust
        | undefined
      return (req: IncomingMessage, res: ServerResponse, next?: (err?: unknown) => void) => {
        if (next) (req as IncomingMessage & { [NEXT]?: (err?: unknown) => void })[NEXT] = next
        // Express and Fastify derive `req.ip` from their trust-proxy settings;
        // this is h3's equivalent, off unless the app opts in, because an
        // unverified `x-forwarded-for` is client-controllable. Without it every
        // caller behind a proxy shares the proxy's address (one rate-limit bucket).
        if (trust && !(req as { ip?: string }).ip) {
          const ip = forwardedClientIp(req, trust)
          if (ip) (req as { ip?: string }).ip = ip
        }
        // h3 v2 adds 'close' / 'finish' listeners for every connect middleware
        // and keeps them until the response ends, so an ordinary middleware
        // stack crosses Node's default of 10 and warns about a leak on every
        // request. They go away with the response; no limit is needed.
        res.setMaxListeners(0)
        try {
          const result = listener(req, res) as unknown
          if (result && typeof (result as Promise<unknown>).then === 'function') {
            void (result as Promise<unknown>).catch((err) => next?.(err))
          }
        } catch (err) {
          next?.(err)
        }
      }
    },

    mountRoutes(app, table: RouteTable) {
      for (const { mountPath, routes } of table) {
        for (const entry of routes) {
          const url = joinPath(mountPath, entry.path)
          const hooks: WebRouteHooks = {
            onError: async (err, req, driver) => {
              const mw = (app as unknown as Record<symbol, ConnectMiddleware | undefined>)[ERROR_MW]
              if (!mw) return
              // Awaited: an async handler answers after its await, and the
              // pipeline falls back to its own answer once this returns.
              try {
                await (mw as (e: unknown, rq: unknown, rs: unknown, n: () => void) => unknown)(
                  err,
                  req,
                  driver,
                  NOOP_NEXT,
                )
              } catch (handlerErr) {
                if (!driver.settled) {
                  log.error(handlerErr, 'h3: the error handler failed')
                  driver.status(500).json({ error: 'Internal Server Error' })
                }
              }
            },
          }
          const run = compileWebRoute(entry, hooks)
          app.on(entry.method, url, (event: H3EventLike) =>
            run({
              request: event.req,
              url: event.url,
              params: event.context.params ?? {},
              carry: event.req.runtime?.node?.req ?? FETCH_CONNECT.get(event)?.req,
            }),
          )
        }
      }
    },

    useConnect(app, rawMw: ConnectMiddleware, opts?: UseConnectOptions) {
      const path = opts?.path
      // A list mounts each member, as Express does.
      if (Array.isArray(path)) {
        for (const member of path) this.useConnect!(app, rawMw, { path: member })
        return
      }
      const mw = typeof path === 'string' ? stripMountPrefix(path, rawMw) : rawMw
      // Behind a node server (toNodeHandler) the event carries node req/res and
      // h3's own bridge runs the middleware unchanged. Called through
      // `app.fetch(request)` there is none and fromNodeHandler would throw, so
      // the middleware runs against the web driver pair instead.
      const viaNode = fromNodeHandler(mw) as (event: H3EventLike) => unknown
      const handler = (event: H3EventLike, next: () => unknown) =>
        event.req.runtime?.node?.res ? viaNode(event) : runConnectOnFetch(mw, event, next)
      if (path instanceof RegExp) {
        // h3 routes by string pattern only; test the pathname per request.
        // Like Express, a pattern mount leaves `req.url` whole.
        app.use((event: H3EventLike, next: () => unknown) =>
          path.test(event.url.pathname) ? handler(event, next) : next(),
        )
      } else if (typeof path === 'string') {
        // h3 `use` is exact-match; `/**` covers the subtree.
        app.use(joinPath(path, '/**'), handler)
      } else {
        app.use(handler)
      }
    },

    serveStatic(app, prefix, dir) {
      // serve-static bridged like any other connect middleware (node only).
      const serveStatic = peerRequire('serve-static')
      this.useConnect(app, serveStatic(dir) as ConnectMiddleware, { path: prefix })
    },

    setNotFound(app, mw: ConnectMiddleware) {
      ;(app as unknown as Record<symbol, ConnectMiddleware>)[NOTFOUND_MW] = mw
      // Here as well as in nodeHandler: an app only ever called through
      // `app.fetch` never reaches nodeHandler, and would answer h3's own 404.
      assembleCatchAll(app)
    },

    setErrorHandler(app, mw: ConnectMiddleware) {
      ;(app as unknown as Record<symbol, ConnectMiddleware>)[ERROR_MW] = mw
    },

    capabilities: {
      render: false,
      uploads: true,
      connectMiddleware: true,
      nativeBodyParsing: true,
      // srvx's node adapter writes HTTP/2 compat responses (it branches on
      // httpVersion "2.0"), so the node path serves `server.http2` too.
      http2: true,
    },
  }
}

/**
 * The h3 runtime's engine-native types, for the `kick/runtime` typegen
 * augmentation. Mirrors `ExpressRuntimeTypes`.
 */
export interface H3RuntimeTypes {
  request: Request
  response: Response
  app: typeof import('h3') extends { H3: new (...args: never[]) => infer A } ? A : unknown
}

/** Join a mount prefix and a route path into one URL, collapsing slashes. */
function joinPath(mountPath: string, path: string): string {
  const a = mountPath.endsWith('/') ? mountPath.slice(0, -1) : mountPath
  if (path === '/' || path === '') return a === '' ? '/' : a
  const b = path.startsWith('/') ? path : `/${path}`
  return `${a}${b}`
}

/** @deprecated Use {@link h3Runtime} — the same runtime. Removed in the next major. */
export const h3WebRuntime = h3Runtime
/** @deprecated Use {@link H3RuntimeOptions}. */
export type H3WebRuntimeOptions = H3RuntimeOptions
/** @deprecated Use {@link H3RuntimeTypes}. */
export type H3WebRuntimeTypes = H3RuntimeTypes
