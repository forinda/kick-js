import type http from 'node:http'
import type { Express } from 'express'
import type { Container } from './container'
import type { MaybePromise, Constructor } from './interfaces'

/**
 * Where in the middleware pipeline an adapter's middleware should be inserted.
 *
 *   beforeGlobal  → runs before any user-defined global middleware
 *   afterGlobal   → runs after global middleware, before module routes
 *   beforeRoutes  → just before module routes are mounted
 *   afterRoutes   → after module routes but before error handlers
 */
export type MiddlewarePhase = 'beforeGlobal' | 'afterGlobal' | 'beforeRoutes' | 'afterRoutes'

/** A middleware entry contributed by an adapter */
export interface AdapterMiddleware {
  /** Express-compatible handler: (req, res, next) => void */
  handler: any
  /** Which phase to insert into (default: 'afterGlobal') */
  phase?: MiddlewarePhase
  /** Optional path to scope the middleware to (e.g. '/api/v1/auth') */
  path?: string
}

/**
 * Context passed to adapter lifecycle hooks.
 * Populated by the Application — provides access to the Express app,
 * DI container, http.Server, and environment info without requiring
 * external type imports. Cast `app` or `server` if you need specific types.
 *
 * @example
 * ```ts
 * beforeMount({ app, container }: AdapterContext) {
 *   app.use(myMiddleware())
 * }
 * ```
 */
export interface AdapterContext {
  /** Express application instance — fully typed */
  app: Express
  /** DI container */
  container: Container
  /** Node.js http.Server — only available in afterStart */
  server?: http.Server
  /** Current NODE_ENV value (default: 'development') */
  env: string
  /** true when NODE_ENV === 'production' */
  isProduction: boolean
}

/**
 * Adapters plug into the Application lifecycle.
 * Implement this to add WebSocket, database, rate limiting, docs, etc.
 *
 * All hooks receive an `AdapterContext` populated by the framework.
 * No external type imports needed — the context is fully typed from KickJS internals.
 *
 * @example
 * ```ts
 * import type { AppAdapter, AdapterContext } from '@forinda/kickjs-core/adapter'
 *
 * class SentryAdapter implements AppAdapter {
 *   name = 'SentryAdapter'
 *
 *   beforeMount({ app, container }: AdapterContext) {
 *     app.use(Sentry.expressRequestHandler())
 *   }
 *
 *   afterStart({ server }: AdapterContext) {
 *     // server is the http.Server — available after listen()
 *   }
 *
 *   async shutdown() {
 *     await Sentry.close(2000)
 *   }
 * }
 * ```
 */
export interface AppAdapter {
  /** Human-readable name for logging */
  name?: string

  /**
   * Return middleware entries to be inserted into the pipeline.
   * The `phase` controls ordering relative to global middleware and routes.
   */
  middleware?(): AdapterMiddleware[]

  /**
   * Called before global middleware — register early routes (docs UI, health).
   * May return a Promise — async rejections are caught and logged.
   */
  beforeMount?(ctx: AdapterContext): void | Promise<void>

  /**
   * Called for each module route that gets mounted.
   * Use this to collect route metadata (e.g. for OpenAPI spec generation).
   */
  onRouteMount?(controllerClass: Constructor, mountPath: string): void

  /**
   * Called after modules are registered and the DI container is bootstrapped,
   * before the HTTP server starts listening. **This is the correct hook for
   * adapters that register DI bindings, resolve services, or otherwise prepare
   * container-side state** (e.g. `container.registerInstance(MAILER, ...)`).
   *
   * `beforeStart` runs inside `app.setup()`, which means it also fires under
   * `createTestApp` — adapters using this hook work in unit tests without
   * needing a live HTTP server. See {@link afterStart} for the contrast.
   *
   * May return a Promise — async rejections are caught and logged.
   */
  beforeStart?(ctx: AdapterContext): void | Promise<void>

  /**
   * Called after the HTTP server is listening — `ctx.server` is the live
   * `http.Server`. **Use this hook only for work that genuinely needs a
   * listening server**: attaching Socket.IO / WS upgrades, reading the bound
   * port via `server.address()`, dispatching to the local server over HTTP,
   * etc.
   *
   * `afterStart` does NOT fire under `createTestApp`, since tests call
   * `app.setup()` and never `app.start()`. If your adapter only registers DI
   * bindings or resolves services, use {@link beforeStart} — that hook runs
   * in both production (`start()`) and tests (`setup()`).
   *
   * May return a Promise — async rejections are caught and logged.
   */
  afterStart?(ctx: AdapterContext): void | Promise<void>

  /**
   * Called by the /health/ready endpoint. Return the health status of your adapter's
   * backing service (database, Redis, queue, etc.).
   */
  onHealthCheck?(): Promise<{ name: string; status: 'up' | 'down' }>

  /** Called on shutdown — clean up connections */
  shutdown?(): MaybePromise
}

/** Constructor type for AppAdapter classes */
export type AppAdapterClass = new () => AppAdapter
