// The h3 v2 (web-standards) runtime — `@forinda/kickjs/h3-web`.
//
// ADDITIVE runtime: the h3 v1 runtime (`./h3.ts`, `@forinda/kickjs/h3`)
// stays untouched so existing adopters keep working (locked decision,
// web-standards-edge-design.md §3.1). This runtime targets h3 >= 2 — the
// web-standard rebase where `event.req` is a WHATWG Request, handlers
// return values/Responses, and `app.fetch(request)` is the universal entry.
//
// The request pipeline runs through the shared web driver pair
// (`../web/driver`, `../web/handler`) — the same code path the
// `@forinda/kickjs/web` edge entry uses, so node bootstrap and edge deploys
// exercise identical request semantics.
//
// Known limitation vs the v1 runtime: no Vite dev-server fall-through —
// unmatched requests are answered by the kick notFound handler (h3 v2 owns
// the full request; there is no node `next()` bail-out mid-engine). Use the
// v1 h3 runtime or Express for Vite-integrated dev setups.

import type { IncomingMessage, ServerResponse } from 'node:http'
import { createRequire } from 'node:module'

import type {
  ConnectMiddleware,
  HttpRuntime,
  RouteTable,
  RuntimeAppOptions,
  UseConnectOptions,
} from '../runtime'
import { compileWebRoute, type WebRouteHooks } from '../web/handler'
import { WebRequestShim, WebResponseDriver } from '../web/driver'
import { createLogger, describeError } from '../../core/logger'

const log = createLogger('H3WebRuntime')

const peerRequire = createRequire(import.meta.url)

const NOTFOUND_MW = Symbol('kickjs.h3web.notFoundMw')
const ERROR_MW = Symbol('kickjs.h3web.errorMw')
const ASSEMBLED = Symbol('kickjs.h3web.assembled')
const NOOP_NEXT = (): void => {}

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

export interface H3WebRuntimeOptions {
  /**
   * Pre-imported h3 v2 module. Two audiences:
   * - Edge/worker bundlers with no `createRequire` at runtime:
   *   `h3WebRuntime({ h3: await import('h3') })`
   * - Tests running both h3 majors side by side via an npm alias.
   * Omitted → the peer is loaded via `createRequire` (node bootstrap path).
   */
  h3?: unknown
}

/** Resolve h3 (injected or peer-required) and fail fast unless it is v2. */
function loadH3v2(injected?: unknown): H3v2Module {
  const mod = injected ?? peerRequire('h3')
  const m = mod as { __esModule?: boolean; default?: Record<string, unknown> } & Record<
    string,
    unknown
  >
  const resolved = (m && m.__esModule && m.default
    ? { ...m.default, ...m }
    : m) as unknown as H3v2Module
  if (typeof resolved.H3 !== 'function') {
    throw new Error(
      "@forinda/kickjs: h3WebRuntime() requires h3 v2 (the web-standards line, npm dist-tag 'latest'), " +
        'but the installed h3 has no H3 class — that is the v1 line. ' +
        "Either `pnpm add h3@latest` for this runtime, or keep h3 v1 and use h3Runtime() from '@forinda/kickjs/h3'.",
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
  const req = new WebRequestShim(event.req, event.url)
  const driver = new WebResponseDriver(event.req.signal)
  if (mw) {
    if (err !== undefined) {
      ;(mw as (e: unknown, rq: unknown, rs: unknown, n: () => void) => void)(
        err,
        req,
        driver,
        NOOP_NEXT,
      )
    } else {
      ;(mw as (rq: unknown, rs: unknown, n: () => void) => void)(req, driver, NOOP_NEXT)
    }
  }
  if (!driver.settled) {
    if (err !== undefined) {
      // The configured error handler ran but didn't settle the response
      // (or there wasn't one). Emitting a bare 500 with no log entry
      // makes this failure invisible on both sides — log it here, since
      // by definition nothing downstream will.
      log.error(err, `h3-web: error handler did not settle the response — ${describeError(err)}`)
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

  /** The response exists (or the request failed): fire `finish` then `close`. */
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
    const mw = state[NOTFOUND_MW] as ConnectMiddleware | undefined
    return runConnectTerminal(mw, event)
  })
}

/**
 * The h3 v2 HTTP runtime. Pass to `bootstrap({ runtime: h3WebRuntime() })`.
 * Requires the h3 v2 peer; fails fast with guidance when v1 is installed.
 */
export function h3WebRuntime(options: H3WebRuntimeOptions = {}): HttpRuntime<H3AppLike> {
  const { H3, toNodeHandler, fromNodeHandler } = loadH3v2(options.h3)

  return {
    name: 'h3-web',

    createApp(_options: RuntimeAppOptions = {}): H3AppLike {
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
      return app
    },

    nodeHandler(app) {
      assembleCatchAll(app)
      const listener = toNodeHandler(app)
      return (req: IncomingMessage, res: ServerResponse, next?: (err?: unknown) => void) => {
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
              ;(mw as (e: unknown, rq: unknown, rs: unknown, n: () => void) => void)(
                err,
                req,
                driver,
                NOOP_NEXT,
              )
            },
          }
          const run = compileWebRoute(entry, hooks)
          app.on(entry.method, url, (event: H3EventLike) =>
            run({
              request: event.req,
              url: event.url,
              params: event.context.params ?? {},
            }),
          )
        }
      }
    },

    useConnect(app, mw: ConnectMiddleware, opts?: UseConnectOptions) {
      // Behind a node server (toNodeHandler) the event carries node req/res and
      // h3's own bridge runs the middleware unchanged. Called through
      // `app.fetch(request)` there is none and fromNodeHandler would throw, so
      // the middleware runs against the web driver pair instead.
      const viaNode = fromNodeHandler(mw) as (event: H3EventLike) => unknown
      const handler = (event: H3EventLike, next: () => unknown) =>
        event.req.runtime?.node?.res ? viaNode(event) : runConnectOnFetch(mw, event, next)
      if (opts?.path !== undefined) {
        // v2 `use` is exact-match; `/**` covers the subtree like v1's prefix.
        app.use(joinPath(String(opts.path), '/**'), handler)
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
    },
  }
}

/**
 * h3-web runtime engine types for the `kick/runtime` typegen augmentation —
 * mirrors {@link import('./h3').H3RuntimeTypes} for the v1 runtime.
 */
export interface H3WebRuntimeTypes {
  request: Request
  response: Response
  app: unknown
}

/** Join a mount prefix and a route path into one URL, collapsing slashes. */
function joinPath(mountPath: string, path: string): string {
  const a = mountPath.endsWith('/') ? mountPath.slice(0, -1) : mountPath
  if (path === '/' || path === '') return a === '' ? '/' : a
  const b = path.startsWith('/') ? path : `/${path}`
  return `${a}${b}`
}
