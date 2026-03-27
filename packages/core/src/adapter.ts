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
  /** Express application instance */
  app: any
  /** DI container */
  container: Container
  /** Node.js http.Server (only available in afterStart) */
  server?: any
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
   * Called after modules registered, before HTTP server starts.
   * May return a Promise — async rejections are caught and logged.
   */
  beforeStart?(ctx: AdapterContext): void | Promise<void>

  /**
   * Called after the HTTP server is listening — attach to the raw http.Server.
   * May return a Promise — async rejections are caught and logged.
   */
  afterStart?(ctx: AdapterContext): void | Promise<void>

  /** Called on shutdown — clean up connections */
  shutdown?(): MaybePromise
}

/** Constructor type for AppAdapter classes */
export type AppAdapterClass = new () => AppAdapter
