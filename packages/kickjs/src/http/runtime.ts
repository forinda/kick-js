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
import type { RequestHandler, ErrorRequestHandler } from 'express'

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
  /** Owning controller class — for DI resolution and adapter introspection. */
  controller: Constructor
  /** Handler method name on the controller. */
  handlerName: string
  /** Zod/JSON-schema validation config from the route decorator, if any. */
  validation?: RouteDefinition['validation']
  /** `@FileUpload` config, if present — the runtime supplies the backend. */
  upload?: FileUploadConfig
}

/** A controller's routes grouped under the module mount prefix. */
export type RouteTable = { mountPath: string; routes: RouteEntry[] }[]

/** Options passed to {@link HttpRuntime.createApp}. */
export interface RuntimeAppOptions {
  /** Express `trust proxy` setting (and the equivalent on other engines). */
  trustProxy?: boolean | string | number | string[]
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
