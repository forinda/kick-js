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
          return runConnectTerminal(mw, event, error)
        },
      })
      holder.app = app
      return app
    },

    nodeHandler(app) {
      const state = app as unknown as Record<symbol, unknown>
      if (!state[ASSEMBLED]) {
        state[ASSEMBLED] = true
        // Terminal catch-all AFTER all mounted routes: kick's own notFound
        // handler answers unmatched paths (h3 v2's default 404 never fires).
        app.all('/**', (event: H3EventLike) => {
          const mw = state[NOTFOUND_MW] as ConnectMiddleware | undefined
          return runConnectTerminal(mw, event)
        })
      }
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
      // Node bootstrap path only — h3 v2 bridges node middleware via
      // fromNodeHandler (the edge entry never calls useConnect).
      const handler = fromNodeHandler(mw)
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
