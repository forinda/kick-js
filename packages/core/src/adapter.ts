import type { Container } from './container'

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
 * Adapters plug into the Application lifecycle.
 * Implement this to add WebSocket, database, rate limiting, docs, etc.
 *
 * @example
 * ```ts
 * class RateLimitAdapter implements AppAdapter {
 *   middleware() {
 *     return [
 *       { path: '/api/v1/auth', handler: rateLimit({ max: 10 }), phase: 'beforeRoutes' },
 *       { handler: rateLimit({ max: 200 }), phase: 'beforeRoutes' },
 *     ]
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

  /** Called before global middleware — register early routes (docs UI, health) */
  beforeMount?(app: any, container: Container): void

  /**
   * Called for each module route that gets mounted.
   * Use this to collect route metadata (e.g. for OpenAPI spec generation).
   */
  onRouteMount?(controllerClass: any, mountPath: string): void

  /** Called after modules registered, before HTTP server starts */
  beforeStart?(app: any, container: Container): void

  /** Called after the HTTP server is listening — attach to the raw http.Server */
  afterStart?(server: any, container: Container): void

  /** Called on shutdown — clean up connections */
  shutdown?(): void | Promise<void>
}

/** Constructor type for AppAdapter classes */
export type AppAdapterClass = new () => AppAdapter
