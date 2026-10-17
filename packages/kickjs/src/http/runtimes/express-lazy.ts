/**
 * The Express runtime as the root entry exports it: `expressRuntime()`,
 * `buildRoutes()` and `materializeRouter()` without importing `express` when
 * `@forinda/kickjs` loads, so an app on Fastify or h3 runs without it installed.
 * The engine loads in `HttpRuntime.load()`, which the Application awaits before
 * creating its app — through a literal dynamic `import()`, which bundlers
 * follow, so `kick build:netlify|vercel` still inlines Express.
 *
 * `@forinda/kickjs/express` exports the same three, loaded eagerly.
 */
import type { ConnectHandler } from '../connect'
import type { HttpRuntime, RouteEntry, RuntimeCapabilities } from '../runtime'
import { buildRouteTable, type BuildRoutesOptions } from '../router-builder'

type ExpressModule = typeof import('./express')

/** What the Express runtime supports — read before the engine loads (`start()` checks `http2`). */
export const EXPRESS_CAPABILITIES: RuntimeCapabilities = {
  render: true,
  uploads: true,
  connectMiddleware: true,
  nativeBodyParsing: false,
  http2: false,
}

let loaded: ExpressModule | undefined
let loading: Promise<ExpressModule> | undefined

/** Start loading Express once; every caller shares the one load. */
function loadExpress(): Promise<ExpressModule> {
  loading ??= import('./express').then(
    (mod) => (loaded = mod),
    (err: unknown) => {
      throw new Error(
        "kickjs: the Express runtime needs the 'express' package — install it, or pass another " +
          "runtime to bootstrap(): `runtime: fastifyRuntime()` from '@forinda/kickjs/fastify', " +
          "or `h3Runtime()` from '@forinda/kickjs/h3'.",
        { cause: err },
      )
    },
  )
  return loading
}

/**
 * Wait for an Express load something already started — `expressRuntime()`
 * starts one when called, so a custom runtime wrapping it (and calling its
 * methods without forwarding `load()`) still finds Express there by setup.
 */
export async function settleExpressLoad(): Promise<void> {
  await loading
}

/**
 * Express's body parsers, for a runtime that neither parses bodies itself nor
 * supplies `bodyParsers()` — what the Application mounted before runtimes
 * could supply their own.
 */
export async function expressBodyParsers(limit: string | number) {
  const mod = await loadExpress()
  return mod.expressRuntime().bodyParsers?.({ limit }) ?? []
}

function notLoaded(what: string): Error {
  return new Error(
    `kickjs: ${what} is Express-only and runs once the Express runtime has loaded — ` +
      "in an app running it. Outside one, import it from '@forinda/kickjs/express'.",
  )
}

/** The default HTTP runtime; Express loads on the Application's first setup. */
export function expressRuntime(): HttpRuntime {
  // Started now and awaited at setup; a failure surfaces there, not as an
  // unhandled rejection here.
  loadExpress().catch(() => {})
  let real: HttpRuntime | undefined
  const engine = (): HttpRuntime => real ?? (real = loaded?.expressRuntime()) ?? fail()
  const fail = (): never => {
    throw notLoaded('expressRuntime() used before load()')
  }
  return {
    name: 'express',
    capabilities: EXPRESS_CAPABILITIES,
    async load() {
      await loadExpress()
      engine()
    },
    createApp: (options) => engine().createApp(options),
    nodeHandler: (app) => engine().nodeHandler(app),
    mountRoutes: (app, table) => engine().mountRoutes(app, table),
    useConnect: (app, mw, opts) => engine().useConnect(app, mw, opts),
    serveStatic: (app, prefix, dir) => engine().serveStatic(app, prefix, dir),
    setNotFound: (app, mw) => engine().setNotFound(app, mw),
    setErrorHandler: (app, mw) => engine().setErrorHandler(app, mw),
    close: (app) => engine().close?.(app),
    bodyParsers: (options) => engine().bodyParsers?.(options) ?? [],
  }
}

/**
 * Materialize route entries onto an Express `Router`, built on the first
 * request (Express has loaded by then in an app running it).
 */
export function materializeRouter(entries: RouteEntry[]): ConnectHandler {
  let router: ConnectHandler | undefined
  return (req, res, next) => {
    if (!loaded) throw notLoaded('materializeRouter()')
    router ??= loaded.materializeRouter(entries)
    return router(req, res, next)
  }
}

/**
 * A controller's routes as an Express `Router`. The route table is built now,
 * so a contributor cycle or a missing dependency still fails at boot; the
 * router on the first request.
 */
export function buildRoutes(
  controllerClass: any,
  options: BuildRoutesOptions = {},
): ConnectHandler {
  return materializeRouter(buildRouteTable(controllerClass, options))
}
