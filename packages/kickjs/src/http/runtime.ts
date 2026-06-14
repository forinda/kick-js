// The HttpRuntime seam (spec: docs/http/spec-http-runtimes.md, Avenue B).
//
// Decorators no longer emit an `express.Router` directly. `buildRouteTable()`
// turns controller metadata into a plain-data `RouteEntry[]`; an `HttpRuntime`
// materializes that table onto whatever engine it owns. Express is the default
// runtime and the only one shipped in M1 — its materializer reproduces the exact
// handler chain the old `buildRoutes()` built, so behavior is unchanged.
//
// Fastify / h3 runtimes (later milestones) consume the SAME `RouteEntry` data
// and the SAME `HttpRuntime` contract; the request/response driver abstraction
// that lets `RequestContext` run engine-agnostically lands with them (M3), since
// under Express the drivers ARE the Express request/response objects already.

import type { IncomingMessage, ServerResponse } from 'node:http'
import type {
  RequestHandler,
  ErrorRequestHandler,
  Express,
  Request as ExpressRequest,
  Response as ExpressResponse,
} from 'express'

import type { Constructor, FileUploadConfig, MiddlewareHandler, RouteDefinition } from '../core'
import type { RequestContext } from './context'

/** HTTP verbs the router emits. Mirrors the decorator surface (@Get/@Post/...). */
export type RouteMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

/**
 * A context-based handler: the runtime-neutral unit of the request pipeline.
 * Contributors, route middleware (via {@link MiddlewareHandler}), and the
 * terminal controller call all reduce to this shape. The runtime owns how a
 * `CtxHandler` is wrapped onto its engine (Express wraps it in `(req, res,
 * next)`; Fastify in its own handler).
 */
export type CtxHandler = (ctx: RequestContext) => unknown | Promise<unknown>

/**
 * Connect-style middleware — the portable middleware format. Built-in
 * middleware and adopter-supplied Express middleware are this shape. The
 * Express runtime hands them straight to `app.use`; later runtimes bridge
 * them (Fastify via `@fastify/middie`, h3 via its node adapter).
 *
 * Typed as the Express handler union for M1 (Express is the only runtime);
 * a future milestone narrows this to bare node `(req, res, next)` primitives
 * once the driver layer lands.
 */
export type ConnectMiddleware = RequestHandler | ErrorRequestHandler

/**
 * One materialized route, as plain data. Produced by {@link buildRouteTable}
 * from decorator metadata; consumed by {@link HttpRuntime.mountRoutes}.
 *
 * The shape is deliberately richer than a flat `CtxHandler[]`: `middlewares`
 * keep the `(ctx, next)` signature (they may short-circuit or call `next(err)`),
 * `contributorRunner` is a closure over the pre-built pipeline + container (the
 * pipeline is built — and any cycle / missing-dep error thrown — at table-build
 * time, i.e. boot), and `validation` / `upload` stay as metadata the runtime
 * materializes its own way. Faithfully reproducing the legacy Express chain —
 * not collapsing it — is what keeps M1 behavior-neutral.
 */
export interface RouteEntry {
  method: RouteMethod
  /** Path with `:param` segments — the portable subset all engines accept. */
  path: string
  /** Class + method middleware, in execution order; each receives `(ctx, next)`. */
  middlewares: MiddlewareHandler[]
  /**
   * Runs the contributor pipeline against `ctx` (populates `ctx.set(...)`),
   * or `null` when no contributors apply. Closes over the built pipeline and
   * the DI container so it stays engine-neutral; the runtime advances the
   * chain (Express: call `next()`) once it resolves.
   */
  contributorRunner: CtxHandler | null
  /** Terminal handler: resolves the controller per-request and invokes it. */
  handler: CtxHandler
  /** Introspection + runtime-materialized concerns (swagger/typegen read this). */
  meta: RouteMeta
}

/** Per-route metadata: introspection refs plus runtime-materialized concerns. */
export interface RouteMeta {
  /**
   * Owning controller class — for DI resolution and adapter introspection.
   * Absent for ad-hoc routes registered through {@link AdapterHttp.route},
   * which have no controller class behind them.
   */
  controller?: Constructor
  /** Handler method name on the controller, when there is one. */
  handlerName?: string
  /** Zod/JSON-schema validation config from the route decorator, if any. */
  validation?: RouteDefinition['validation']
  /** `@FileUpload` config, if present — the runtime supplies the backend. */
  upload?: FileUploadConfig
}

/** A controller's routes grouped under the module mount prefix. */
export type RouteTable = { mountPath: string; routes: RouteEntry[] }[]

/**
 * The response surface {@link RequestContext}'s helpers (`json` / `html` /
 * `sse` / `download` / `render` / `problem`) drive, instead of calling Express
 * `res` methods directly (spec §4.3). Sized so `express.Response` satisfies it
 * structurally — under the Express runtime the driver IS the Express response,
 * so there is no wrapping and no behavior change. Other runtimes (Fastify / h3)
 * provide a thin object implementing this over their native reply.
 *
 * The terminal methods return `RuntimeResponse` for fluent chaining (Express's
 * `Response` is assignable, since it is a superset).
 */
export interface RuntimeResponse {
  status(code: number): RuntimeResponse
  json(data: unknown): RuntimeResponse
  send(data: unknown): RuntimeResponse
  type(contentType: string): RuntimeResponse
  setHeader(name: string, value: string | number | readonly string[]): unknown
  render(view: string, data?: Record<string, unknown>): unknown
  writeHead(statusCode: number, headers?: Record<string, string>): unknown
  flushHeaders(): unknown
  write(chunk: string | Buffer): boolean
  end(data?: unknown): unknown
  once(event: 'close', listener: () => void): unknown
  readonly headersSent: boolean
}

// ── Runtime-typed escape hatches (spec §4.3b) ─────────────────────────────

/**
 * Per-runtime type map: the engine-native request / response / app types an
 * `HttpRuntime` exposes through `ctx.req.raw` / `ctx.res.raw` / `AdapterContext.app`.
 */
export interface RuntimeTypeMap {
  request: unknown
  response: unknown
  app: unknown
}

/** The Express runtime's native types — the default when nothing is augmented. */
export interface ExpressRuntimeTypes {
  request: ExpressRequest
  response: ExpressResponse
  app: Express
}

/**
 * Augmentable runtime registry. Empty by default; the `kick/runtime` typegen
 * plugin emits a `{ runtime: <RuntimeTypeMap> }` augmentation from the configured
 * runtime, which flips the engine-native escape-hatch types — `AdapterContext.app`,
 * `getRuntimeApp()`, and (once the driver layer lands) `ctx.req.raw` / `ctx.res.raw`
 * — to that runtime. Mirrors `KickDbRegister` / `KickEnv`, so the type story is
 * uniform with `kick/db` and env typing.
 *
 * @example
 * ```ts
 * // .kickjs/types/kick__runtime.d.ts — generated by typegen
 * declare module '@forinda/kickjs' {
 *   interface KickRuntimeRegister {
 *     runtime: import('@forinda/kickjs/fastify').FastifyRuntimeTypes
 *   }
 * }
 * ```
 */

export interface KickRuntimeRegister {}

/** The active runtime's type map — the augmented one, or Express by default. */
export type ActiveRuntime = KickRuntimeRegister extends { runtime: infer R extends RuntimeTypeMap }
  ? R
  : ExpressRuntimeTypes

/** Options passed to {@link HttpRuntime.createApp}. */
export interface RuntimeAppOptions {
  /**
   * Express `trust proxy` setting (and the equivalent on other engines). The
   * function form is Express-specific; other runtimes interpret the simpler
   * shapes (or normalize X-Forwarded-For themselves — see spec §10 Q1).
   */
  trustProxy?: boolean | string | number | string[] | ((ip: string, hopIndex: number) => boolean)
}

/** Where a connect middleware sits and what it scopes to. */
export interface UseConnectOptions {
  path?: string | RegExp | ReadonlyArray<string | RegExp>
}

/**
 * Optional engine capabilities. Absence means the corresponding `ctx` feature
 * raises a clear error on that runtime rather than failing obscurely.
 */
export interface RuntimeCapabilities {
  /** View-engine rendering (`ctx.render`). Express: true; Fastify/h3: false initially. */
  render: boolean
  /** File uploads (`ctx.file` / `@FileUpload`). All engines, different backends. */
  uploads: boolean
  /** Connect-style middleware. Express/Fastify(middie): true; h3: best-effort. */
  connectMiddleware: boolean
}

/**
 * The engine driver. KickJS owns decorators → {@link RouteTable}, the
 * contributor pipeline, the `RequestContext` surface, and error mapping. The
 * runtime owns app/server creation, route materialization, connect-middleware
 * registration, static serving, and the terminal not-found / error handlers.
 *
 * `expressRuntime()` is the default and the M1 reference implementation.
 */
export interface HttpRuntime<TApp = unknown> {
  readonly name: 'express' | 'fastify' | 'h3' | (string & {})

  /** Create the engine app. Called once per Application (and per HMR rebuild). */
  createApp(options?: RuntimeAppOptions): TApp

  /**
   * Node-compatible request listener — the transport contract.
   * `http.createServer(handler)` in prod, Vite post-middleware in dev. MUST
   * invoke `next` (when given) instead of 404-ing if no route matched — the
   * Vite dev chain depends on fall-through.
   */
  nodeHandler(
    app: TApp,
  ): (req: IncomingMessage, res: ServerResponse, next?: (err?: unknown) => void) => void

  /** Materialize the framework-built route table onto the engine. */
  mountRoutes(app: TApp, table: RouteTable): void

  /** Register a connect-style middleware (built-ins + adopter middleware). */
  useConnect(app: TApp, mw: ConnectMiddleware, opts?: UseConnectOptions): void

  /** Serve a static directory (swagger-ui assets, devtools SPA). */
  serveStatic(app: TApp, prefix: string, dir: string): void

  /** Terminal not-found handler. */
  setNotFound(app: TApp, mw: ConnectMiddleware): void

  /** Terminal error handler. */
  setErrorHandler(app: TApp, mw: ConnectMiddleware): void

  readonly capabilities: RuntimeCapabilities
}

/**
 * The supported surface adapters use to add HTTP routes, mounts, static dirs,
 * and middleware — engine-agnostic, in place of reaching for the raw Express
 * `app` (spec §4.4). Exposed as {@link AdapterContext.http}. Built by the
 * Application over the active {@link HttpRuntime}, so an adapter written against
 * this works under any runtime; the raw `app` escape hatch stays available for
 * the rare engine-specific need.
 */
export interface AdapterHttp {
  /** Register a single context-handler route (e.g. a docs or transport endpoint). */
  route(method: RouteMethod, path: string, handler: CtxHandler): void
  /** Mount a pre-built route table under a path prefix. */
  mount(prefix: string, routes: RouteEntry[]): void
  /** Serve a static directory under a path prefix. */
  serveStatic(prefix: string, dir: string): void
  /** Register a connect-style middleware (optionally path-scoped). */
  use(mw: ConnectMiddleware, opts?: UseConnectOptions): void
}
