import http from 'node:http'
import express, { type Express, type RequestHandler } from 'express'
import {
  Container,
  createLogger,
  Logger,
  normalizePath,
  METADATA,
  type AppModule,
  type AppModuleClass,
  type AppAdapter,
  type AdapterContext,
  type AdapterMiddleware,
  type ContributorRegistration,
  type KickPlugin,
  type RouteDefinition,
  type SourcedRegistration,
  mountSort,
} from '../core'
import { getClassMeta } from '../core/metadata'
import { requestId } from './middleware/request-id'
import { notFoundHandler, errorHandler } from './middleware/error-handler'
import { requestScopeMiddleware, isRequestScopeMiddleware } from './middleware/request-scope'
import { _setExternalContributorSources } from './router-builder'
import { requestStore, getRequestStore } from './request-store'

const log = createLogger('Application')

/**
 * A middleware entry in the declarative pipeline.
 * Can be a bare handler or an object with path scoping.
 */
export type MiddlewareEntry = RequestHandler | { path: string; handler: RequestHandler }

export interface ApplicationOptions {
  /** Feature modules to load */
  modules: AppModuleClass[]
  /** Adapters that hook into the lifecycle (DB, Redis, Swagger, etc.) */
  adapters?: AppAdapter[]
  /** Server port (falls back to PORT env var, then 3000) */
  port?: number
  /** Global API prefix (default: '/api') */
  apiPrefix?: string
  /** Default API version (default: 1) — routes become /{prefix}/v{version}/{path} */
  defaultVersion?: number

  /**
   * Global middleware pipeline. Declared in order.
   * Replaces the hardcoded middleware stack — you control exactly what runs.
   *
   * @example
   * ```ts
   * bootstrap({
   *   modules,
   *   middleware: [
   *     helmet(),
   *     cors(),
   *     compression(),
   *     morgan('dev'),
   *     express.json({ limit: '1mb' }),
   *   ],
   * })
   * ```
   *
   * If omitted, a sensible default is applied:
   *   requestId(), express.json({ limit: '100kb' })
   */
  middleware?: MiddlewareEntry[]

  /** Plugins that bundle modules, adapters, middleware, and DI bindings */
  plugins?: KickPlugin[]

  /**
   * Global Context Contributors (#107) that apply to every route in the
   * application. Merge into the per-route pipeline at the `'global'`
   * precedence level — they lose to module, adapter, class, and method
   * contributors with the same key, providing app-wide defaults that any
   * narrower scope can override.
   *
   * @example
   * ```ts
   * const StartedAt = defineContextDecorator({
   *   key: 'requestStartedAt',
   *   resolve: () => Date.now(),
   * })
   *
   * bootstrap({
   *   modules,
   *   contributors: [StartedAt.registration],
   * })
   * ```
   */
  contributors?: ContributorRegistration[] | readonly ContributorRegistration[]

  /**
   * Backing store strategy for {@link RequestContext} `set/get` and the
   * Context Contributor pipeline (#107).
   *
   * - `'auto'` (default) — Application mounts {@link requestScopeMiddleware}
   *   automatically before any user middleware. If the user-supplied
   *   `middleware` list already includes `requestScopeMiddleware()`,
   *   detection skips the auto-mount so adopters can control its position.
   * - `'manual'` — Application never mounts the wrapper. The Context
   *   Contributor pipeline still runs on every route — the runner is
   *   inserted by `router-builder` regardless of ALS state. What
   *   degrades without an ALS frame is the *backing store*:
   *   REQUEST-scoped DI throws (no `requestStore.getStore()` to read
   *   from), `Logger` loses its requestId context, and
   *   `RequestContext.set/get` throws. Use `'manual'` only when you
   *   genuinely intend to wrap requests in your own ALS frame (rare —
   *   multi-tenant adapters used to do this; post-Phase 3 they share
   *   the framework's frame instead).
   */
  contextStore?: 'auto' | 'manual'

  /** Express `trust proxy` setting */
  trustProxy?: boolean | number | string | ((ip: string, hopIndex: number) => boolean)
  /** Maximum JSON body size (only used when middleware is not provided) */
  jsonLimit?: string | number
  /**
   * Log route summary on startup. Default: true in dev, false in production.
   * Set to `true` to always log, `false` to always suppress.
   */
  logRoutesTable?: boolean
  /**
   * Maximum time (ms) to wait for graceful shutdown before forcing exit.
   * Default: 30000 (30 seconds). Set to 0 to disable forced exit.
   */
  shutdownTimeout?: number

  /**
   * Enable cluster mode for multi-core utilization.
   *
   * When enabled, the primary process forks worker processes that share the
   * same port via Node's built-in `cluster` module (OS load balancing).
   *
   * - `true` — use all available CPU cores
   * - `{ workers: N }` — use exactly N workers
   *
   * Workers are auto-restarted on crash. SIGTERM/SIGINT on the primary is
   * forwarded to all workers.
   *
   * @example
   * ```ts
   * bootstrap({ modules, cluster: true })
   * bootstrap({ modules, cluster: { workers: 4 } })
   * ```
   */
  cluster?: boolean | { workers?: number }

  /**
   * Custom 404 handler for unmatched routes. Receives the raw Express
   * `(req, res, next)` args. When omitted, the built-in handler returns
   * `{ message: 'Not Found' }` with status 404.
   *
   * @example
   * ```ts
   * bootstrap({
   *   modules,
   *   onNotFound: (req, res) => {
   *     res.status(404).json({ error: 'Route not found', path: req.originalUrl })
   *   },
   * })
   * ```
   */
  onNotFound?: (req: any, res: any, next: any) => void

  /**
   * Custom global error handler. Receives `(err, req, res, next)` — the
   * standard Express error-handling signature. When omitted, the built-in
   * handler formats ZodError, HttpException, and unexpected errors.
   *
   * @example
   * ```ts
   * bootstrap({
   *   modules,
   *   onError: (err, req, res, next) => {
   *     logger.error(err)
   *     res.status(err.status ?? 500).json({ error: err.message })
   *   },
   * })
   * ```
   */
  onError?: (err: any, req: any, res: any, next: any) => void

  /**
   * Security defaults applied automatically unless opted out.
   *
   * When not specified, secure defaults are applied:
   * - Helmet security headers are auto-injected
   * - JSON body limit defaults to 1MB
   *
   * @example
   * ```ts
   * bootstrap({
   *   modules,
   *   security: {
   *     helmet: false,     // disable auto-helmet
   *   },
   * })
   * ```
   */
  security?: {
    /** Auto-inject helmet security headers. Default: true */
    helmet?: boolean
  }
}

/**
 * The main application class. Wires together Express, the DI container,
 * feature modules, adapters, and the middleware pipeline.
 */
export class Application {
  private app: Express
  private container: Container
  private httpServer: http.Server | null = null
  private readonly adapters: AppAdapter[]

  private readonly plugins: KickPlugin[]

  /** Number of HTTP requests currently being processed */
  private _inFlightRequests = 0
  /** Whether the application is draining (shutting down gracefully) */
  private _draining = false
  /** Whether shutdown has already been initiated (prevents double-shutdown) */
  private _shutdownInitiated = false
  /** Resolvers waiting for in-flight requests to reach zero */
  private _drainResolvers: Array<() => void> = []

  constructor(private readonly options: ApplicationOptions) {
    this.app = express()
    this.container = Container.getInstance()

    // Sort plugins by `dependsOn` declarations BEFORE reading their adapters/etc.
    // Plugins without `dependsOn` keep their declaration order — this is a
    // pure refinement; no behaviour change for apps that don't use the field.
    this.plugins = mountSort(options.plugins ?? [], 'plugin')

    // Build adapter list from plugin adapters + user adapters, synthesize
    // a stable name for any anonymous adapter (so duplicate-name detection
    // and `dependsOn` resolution have something to key on), then sort by
    // adapter `dependsOn`. Plugin-shipped adapters keep their plugin's
    // relative order unless their own `dependsOn` says otherwise.
    const allAdapters = [
      ...this.plugins.flatMap((p) => p.adapters?.() ?? []),
      ...(options.adapters ?? []),
    ]
    let anonAdapterCount = 0
    const namedAdapters: Array<AppAdapter & { name: string }> = allAdapters.map((adapter) => {
      if (!adapter.name) {
        // `constructor.name === 'Object'` for plain object-literal adapters —
        // useless as an identity since two anonymous literals would collide.
        // Only borrow the constructor name when it's an actual class.
        const ctorName = adapter.constructor?.name
        const fallback =
          ctorName && ctorName !== 'Object' ? ctorName : `AnonymousAdapter#${anonAdapterCount++}`
        return Object.assign(adapter, { name: fallback })
      }
      return adapter as AppAdapter & { name: string }
    })
    this.adapters = mountSort(namedAdapters, 'adapter')
    // Wire the request store provider so Container can resolve REQUEST-scoped deps
    Container._requestStoreProvider = () => requestStore.getStore() ?? null
    // Wire logger context provider so logs auto-include requestId
    Logger._contextProvider = () => {
      const store = requestStore.getStore()
      if (!store) return null
      const ctx: Record<string, any> = { requestId: store.requestId }
      const traceId = store.values.get('traceId')
      if (traceId) ctx.traceId = traceId
      const spanId = store.values.get('spanId')
      if (spanId) ctx.spanId = spanId
      return ctx
    }
  }

  /** Whether the application is currently draining in-flight requests */
  get isDraining(): boolean {
    return this._draining
  }

  /** Number of HTTP requests currently being processed */
  get inFlightRequests(): number {
    return this._inFlightRequests
  }

  /** Get the DI container instance */
  getContainer(): Container {
    return this.container
  }

  /**
   * Express request handler — delegates to the internal Express app.
   *
   * Used by the Vite dev-server plugin to route requests through KickJS:
   * ```ts
   * const mod = await ssrLoadModule('virtual:kickjs/app')
   * mod.app.handle(req, res, next)
   * ```
   *
   * Also works as a standard Node.js request handler for production:
   * ```ts
   * http.createServer(app.handle.bind(app))
   * ```
   */
  handle(req: http.IncomingMessage, res: http.ServerResponse, next?: (err?: any) => void): void {
    if (next) {
      this.app(req as any, res as any, next)
    } else {
      this.app(req as any, res as any)
    }
  }

  /**
   * Full setup pipeline:
   * 1. Adapter beforeMount hooks (early routes — docs, health)
   * 2. Adapter middleware (phase: beforeGlobal)
   * 3. Global middleware (user-declared or defaults)
   * 4. Adapter middleware (phase: afterGlobal)
   * 5. Module registration + DI bootstrap
   * 6. Adapter middleware (phase: beforeRoutes)
   * 7. Module route mounting
   * 8. Adapter middleware (phase: afterRoutes)
   * 9. Error handlers (notFound + global)
   * 10. Adapter beforeStart hooks
   */
  /** Build the adapter context object (shared across all hooks) */
  private adapterCtx(server?: any): AdapterContext {
    const env = process.env.NODE_ENV ?? 'development'
    return {
      app: this.app,
      container: this.container,
      server,
      env,
      isProduction: env === 'production',
    }
  }

  /** Call an adapter hook, awaiting async hooks and catching errors */
  private async callHook(
    hook: ((ctx: AdapterContext) => void | Promise<void>) | undefined,
    ctx: AdapterContext,
  ): Promise<void> {
    if (!hook) return
    try {
      const result = hook(ctx)
      if (result && typeof (result as Promise<void>).then === 'function') {
        await result
      }
    } catch (err) {
      log.error(err, 'Adapter hook failed')
    }
  }

  async setup(): Promise<void> {
    log.debug('Bootstrapping application...')

    // Collect adapter middleware by phase
    const adapterMw = this.collectAdapterMiddleware()

    // Expose the Application instance on the Express app for adapter discovery
    ;(this.app as any).__kickApp = this

    const ctx = this.adapterCtx()

    // ── 1. Adapter beforeMount hooks ──────────────────────────────────
    for (const adapter of this.adapters) {
      await this.callHook(adapter.beforeMount?.bind(adapter), ctx)
    }

    // ── 2. Hardened defaults ──────────────────────────────────────────
    this.app.disable('x-powered-by')
    this.app.set('trust proxy', this.options.trustProxy ?? false)

    // ── 2a. In-flight request tracking ──────────────────────────────
    this.app.use(this.requestTrackingMiddleware())

    // ── 2b. Health check endpoints (before middleware, at root) ──────
    this.mountHealthEndpoints()

    // ── 2c. Request scope (AsyncLocalStorage) ────────────────────────
    // Auto-mounted unless the user opted out (`contextStore: 'manual'`)
    // or already included one in their middleware list.
    if (this.shouldAutoMountRequestScope()) {
      this.app.use(requestScopeMiddleware())
    }

    // ── 3. Adapter middleware: beforeGlobal ───────────────────────────
    this.mountMiddlewareList(adapterMw.beforeGlobal)

    // ── 3b. Plugin registration ──────────────────────────────────────
    for (const plugin of this.plugins) {
      plugin.register?.(this.container)
    }

    // ── 3c. Plugin middleware ─────────────────────────────────────────
    for (const plugin of this.plugins) {
      try {
        const mw = plugin.middleware?.() ?? []
        for (const handler of mw) {
          this.app.use(handler)
        }
      } catch (err) {
        log.error(err, `Plugin middleware failed: ${(plugin as any).name ?? 'unknown'}`)
      }
    }

    // ── 4. Global middleware ─────────────────────────────────────────
    // Auto-inject helmet unless opted out
    const autoHelmet = this.options.security?.helmet !== false
    if (autoHelmet) {
      try {
        const { helmet: helmetFn } = await import('./middleware/helmet')
        this.app.use(helmetFn())
      } catch {
        // helmet middleware not available — skip silently
      }
    }

    if (this.options.middleware) {
      // User-declared pipeline — full control
      for (const entry of this.options.middleware) {
        this.mountMiddlewareEntry(entry)
      }
    } else {
      // Sensible defaults when no middleware declared
      this.app.use(requestId())
      this.app.use(express.json({ limit: this.options.jsonLimit ?? '1mb' }))
    }

    // ── 5. Adapter middleware: afterGlobal ────────────────────────────
    this.mountMiddlewareList(adapterMw.afterGlobal)

    // ── 6. Module registration + DI bootstrap ────────────────────────
    // Plugin modules first, then user modules
    const allModuleClasses = [
      ...this.plugins.flatMap((p) => p.modules?.() ?? []),
      ...this.options.modules,
    ]
    const modules = allModuleClasses.map((ModuleClass) => {
      const mod = new ModuleClass()
      // `register()` is optional — modules whose classes are entirely
      // decorator-managed (@Service, @Controller, @Repository) don't need it.
      mod.register?.(this.container)
      return mod
    })
    this.container.bootstrap()

    // ── 7. Adapter middleware: beforeRoutes ───────────────────────────
    this.mountMiddlewareList(adapterMw.beforeRoutes)

    // ── 8. Mount module routes with versioning ───────────────────────
    const apiPrefix = this.options.apiPrefix ?? '/api'
    const defaultVersion = this.options.defaultVersion ?? 1
    const shouldLogRoutes = this.options.logRoutesTable ?? process.env.NODE_ENV !== 'production'

    // Collect route metadata during mounting (avoids calling mod.routes() twice)
    const mountedRoutes: Array<{ controller: any; mountPath: string }> = []

    // Context Contributors (#107) — collect adapter + plugin + global once;
    // per-module sources are computed inside the loop so module isolation is
    // preserved.
    //
    // Plugin contributors merge at the same `'adapter'` precedence as adapter
    // contributors. Plugins are conceptually "bundles of adapters + extras",
    // so a plugin that ships a typed contributor without standing up an
    // accompanying adapter behaves identically to one that does.
    const adapterSources: SourcedRegistration[] = []
    for (const adapter of this.adapters) {
      const adapterContribs = adapter.contributors?.() ?? []
      const adapterLabel = adapter.name ?? adapter.constructor.name ?? 'adapter'
      for (const registration of adapterContribs) {
        adapterSources.push({ source: 'adapter', registration, label: adapterLabel })
      }
    }
    for (const plugin of this.plugins) {
      const pluginContribs = plugin.contributors?.() ?? []
      const pluginLabel = plugin.name ?? plugin.constructor?.name ?? 'plugin'
      for (const registration of pluginContribs) {
        adapterSources.push({ source: 'adapter', registration, label: pluginLabel })
      }
    }
    const globalSources: SourcedRegistration[] = (this.options.contributors ?? []).map(
      (registration): SourcedRegistration => ({
        source: 'global',
        registration,
        label: 'bootstrap',
      }),
    )

    for (const mod of modules) {
      const moduleSources: SourcedRegistration[] = (mod.contributors?.() ?? []).map(
        (registration): SourcedRegistration => ({
          source: 'module',
          registration,
          label: mod.constructor?.name ?? 'module',
        }),
      )

      // Thread per-module + adapter + global sources to buildRoutes via the
      // module-scoped slot. Module setup is sequential, so the slot is
      // race-free; the finally block clears it even if mod.routes() throws.
      _setExternalContributorSources([...moduleSources, ...adapterSources, ...globalSources])
      let result: ReturnType<AppModule['routes']>
      try {
        result = mod.routes()
      } finally {
        _setExternalContributorSources([])
      }
      if (!result) continue // Non-HTTP modules (queues, cron) may return null

      const routeSets = Array.isArray(result) ? result : [result]

      for (const route of routeSets) {
        const version = route.version ?? defaultVersion
        const mountPath = `${apiPrefix}/v${version}${normalizePath(route.path)}`
        this.app.use(mountPath, route.router)

        // Notify adapters (e.g. SwaggerAdapter for OpenAPI spec generation)
        if (route.controller) {
          for (const adapter of this.adapters) {
            try {
              adapter.onRouteMount?.(route.controller, mountPath)
            } catch (err) {
              log.error(err, `adapter.onRouteMount() failed for ${mountPath}`)
            }
          }
          if (shouldLogRoutes) {
            mountedRoutes.push({ controller: route.controller, mountPath })
          }
        }
      }
    }

    // ── 8b. Log route summary ─────────────────────────────────────────
    if (shouldLogRoutes && mountedRoutes.length > 0) {
      const methodOrder = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
      const methodRank = (m: string) => {
        const i = methodOrder.indexOf(m)
        return i === -1 ? 99 : i
      }

      let totalRoutes = 0
      log.debug('Routes:')

      for (const { controller, mountPath } of mountedRoutes) {
        const defs: RouteDefinition[] = getClassMeta<RouteDefinition[]>(
          METADATA.ROUTES,
          controller,
          [],
        )
        if (defs.length === 0) continue

        const counts: Record<string, number> = {}
        for (const def of defs) {
          const m = def.method.toUpperCase()
          counts[m] = (counts[m] || 0) + 1
        }
        totalRoutes += defs.length

        const methods = Object.entries(counts)
          .sort(([a], [b]) => methodRank(a) - methodRank(b))
          .map(([m, n]) => `${n} ${m}`)
          .join(', ')
        const name = controller.name || 'Controller'
        log.debug(`  ${name.padEnd(30)} ${mountPath.padEnd(25)} ${defs.length} routes (${methods})`)
      }

      log.debug(`  Total: ${totalRoutes} routes`)
    }

    // ── 9. Adapter middleware: afterRoutes ────────────────────────────
    this.mountMiddlewareList(adapterMw.afterRoutes)

    // ── 10. Error handlers ───────────────────────────────────────────
    this.app.use(this.options.onNotFound ?? notFoundHandler())
    this.app.use(this.options.onError ?? errorHandler())

    // ── 11. Adapter beforeStart hooks ────────────────────────────────
    for (const adapter of this.adapters) {
      await this.callHook(adapter.beforeStart?.bind(adapter), ctx)
    }
  }

  /** Register modules and DI without starting the HTTP server (used by kick tinker) */
  async registerOnly(): Promise<void> {
    await this.setup()
  }

  /**
   * Start the HTTP server.
   *
   * In **dev mode** (Vite plugin active): reuses `globalThis.__kickjs_httpServer`
   * created by Vite. Adapters (WsAdapter, Socket.IO, etc.) receive the real
   * `http.Server` through `afterStart({ server })` — zero adapter changes needed.
   *
   * In **production**: creates its own `http.Server` and binds to the port.
   */
  async start(): Promise<void> {
    await this.setup()

    const g = globalThis as any

    if (g.__kickjs_httpServer) {
      // ── DEV MODE: Vite owns the http.Server ──────────────────────
      // Don't create a new server or listen — Vite is already listening.
      // Just wire up adapters with the Vite-created server.
      this.httpServer = g.__kickjs_httpServer
      log.debug('Attached to Vite dev server')

      for (const adapter of this.adapters) {
        const ctx = this.adapterCtx(this.httpServer!)
        await this.callHook(adapter.afterStart?.bind(adapter), ctx)
      }

      for (const plugin of this.plugins) {
        await plugin.onReady?.(this.container)
      }

      return
    }

    // ── PRODUCTION: Create and own the http.Server ─────────────────
    const port = this.options.port ?? parseInt(process.env.PORT || '3000', 10)
    this.httpServer = http.createServer(this.app)

    this.httpServer.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        log.error(
          `Port ${port} is already in use. Kill the existing process or use a different port:\n` +
            `  PORT=${port + 1} kick dev\n` +
            `  lsof -i :${port}   # find what's using it\n` +
            `  kill <PID>          # stop it`,
        )
        process.exit(1)
      }
      throw err
    })

    // Wrap listen in a Promise so afterStart/onReady errors propagate
    await new Promise<void>((resolve, reject) => {
      this.httpServer!.listen(port, async () => {
        try {
          log.info(`Server running on http://localhost:${port}`)

          for (const adapter of this.adapters) {
            const afterCtx = this.adapterCtx(this.httpServer!)
            await this.callHook(adapter.afterStart?.bind(adapter), afterCtx)
          }

          // Plugin onReady hooks
          for (const plugin of this.plugins) {
            await plugin.onReady?.(this.container)
          }

          resolve()
        } catch (err) {
          reject(err)
        }
      })
    })
  }

  /** HMR rebuild: swap Express handler without restarting the server */
  async rebuild(): Promise<void> {
    // Build the new app fully before swapping — if setup() throws,
    // the old app keeps running so the server stays responsive.
    const prevApp = this.app
    const prevContainer = this.container

    try {
      Container.reset()
      this.container = Container.getInstance()
      this.app = express()
      await this.setup()
    } catch (err) {
      log.error(err, 'HMR rebuild failed, keeping previous app')
      // Restore previous state so the server stays responsive
      this.app = prevApp
      this.container = prevContainer
      return
    }

    if (this.httpServer) {
      this.httpServer.removeAllListeners('request')
      this.httpServer.on('request', this.app)
      log.debug('HMR: Express app rebuilt and swapped')
    }
  }

  /**
   * Graceful shutdown with request draining.
   *
   * 1. Stops accepting new connections (server.close())
   * 2. Waits for in-flight requests to complete (up to shutdownTimeout)
   * 3. Calls adapter.shutdown() for all registered adapters
   * 4. Force-closes after timeout
   *
   * Safe to call multiple times — subsequent calls return the same promise.
   */
  async shutdown(): Promise<void> {
    // Prevent double-shutdown — return immediately if already initiated
    if (this._shutdownInitiated) {
      log.debug('Shutdown already in progress, skipping duplicate call')
      return
    }
    this._shutdownInitiated = true
    this._draining = true

    log.debug('Shutting down — draining in-flight requests...')

    const timeoutMs = this.options.shutdownTimeout ?? 30_000
    let timer: ReturnType<typeof setTimeout> | undefined

    // Start a force-exit timer if timeout is configured
    const forceExitPromise =
      timeoutMs > 0
        ? new Promise<'timeout'>((resolve) => {
            timer = setTimeout(() => resolve('timeout'), timeoutMs)
            timer.unref()
          })
        : new Promise<never>(() => {}) // never resolves — no forced exit

    try {
      // Step 1: Stop accepting new connections.
      // server.close() prevents new connections. Its callback fires only when
      // ALL existing connections are fully closed, so we do NOT await it here —
      // we track request draining separately via the tracking middleware.
      if (this.httpServer) {
        this.httpServer.close(() => {})
      }

      // Step 2: Wait for in-flight requests to drain (or timeout)
      if (this._inFlightRequests > 0) {
        log.debug(`Waiting for ${this._inFlightRequests} in-flight request(s) to complete...`)
        const drainPromise = new Promise<'drained'>((resolve) => {
          this._drainResolvers.push(() => resolve('drained'))
        })

        const result = await Promise.race([drainPromise, forceExitPromise])
        if (result === 'timeout') {
          log.warn(
            `Shutdown timeout (${timeoutMs}ms) reached with ${this._inFlightRequests} request(s) still in-flight, forcing shutdown`,
          )
        } else {
          log.debug('All in-flight requests completed')
        }
      }

      // Step 3: Run all plugin + adapter shutdowns concurrently
      const results = await Promise.allSettled([
        ...this.plugins.map((plugin) => Promise.resolve(plugin.shutdown?.())),
        ...this.adapters.map((adapter) => Promise.resolve(adapter.shutdown?.())),
      ])
      for (const result of results) {
        if (result.status === 'rejected') {
          log.error({ err: result.reason }, 'Adapter shutdown failed')
        }
      }
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  getExpressApp(): Express {
    return this.app
  }

  /** Get registered adapters — used by DevToolsAdapter for peer discovery */
  getAdapters(): AppAdapter[] {
    return this.adapters
  }

  /**
   * Get registered plugins — used by DevToolsAdapter for topology
   * introspection (architecture.md §23). Read-only; returns the
   * already-sorted plugin list (post-`dependsOn` topo-sort).
   */
  getPlugins(): readonly KickPlugin[] {
    return this.plugins
  }

  getHttpServer(): http.Server | null {
    return this.httpServer
  }

  // ── Internal helpers ────────────────────────────────────────────────

  /**
   * Decide whether {@link Application} should auto-mount the
   * {@link requestScopeMiddleware} ALS wrapper.
   *
   * Returns `false` when:
   * - `contextStore: 'manual'` was set (caller manages ALS frames), or
   * - the user-supplied `middleware` list already includes a
   *   `requestScopeMiddleware()` (detected via the symbol marker stamped
   *   in `middleware/request-scope.ts`).
   *
   * Otherwise `true` — preserves the historical default of "always wrap
   * requests in an ALS frame" so existing apps see no behavior change.
   */
  private shouldAutoMountRequestScope(): boolean {
    if (this.options.contextStore === 'manual') return false

    const userEntries = this.options.middleware ?? []
    for (const entry of userEntries) {
      const handler = typeof entry === 'function' ? entry : entry.handler
      if (isRequestScopeMiddleware(handler)) return false
    }
    return true
  }

  private collectAdapterMiddleware() {
    const result = {
      beforeGlobal: [] as AdapterMiddleware[],
      afterGlobal: [] as AdapterMiddleware[],
      beforeRoutes: [] as AdapterMiddleware[],
      afterRoutes: [] as AdapterMiddleware[],
    }

    for (const adapter of this.adapters) {
      const entries = adapter.middleware?.() ?? []
      for (const entry of entries) {
        const phase = entry.phase ?? 'afterGlobal'
        result[phase].push(entry)
      }
    }

    return result
  }

  private mountMiddlewareList(entries: AdapterMiddleware[]): void {
    for (const entry of entries) {
      if (entry.path) {
        this.app.use(entry.path, entry.handler)
      } else {
        this.app.use(entry.handler)
      }
    }
  }

  private mountMiddlewareEntry(entry: MiddlewareEntry): void {
    if (typeof entry === 'function') {
      this.app.use(entry)
    } else {
      this.app.use(entry.path, entry.handler)
    }
  }

  /** Middleware that tracks in-flight requests for graceful draining */
  private requestTrackingMiddleware(): RequestHandler {
    return (_req, res, next) => {
      this._inFlightRequests++
      const onFinish = () => {
        res.removeListener('finish', onFinish)
        res.removeListener('close', onFinish)
        this._inFlightRequests--
        // If draining and no more in-flight requests, resolve all waiters
        if (this._draining && this._inFlightRequests === 0) {
          for (const resolve of this._drainResolvers) {
            resolve()
          }
          this._drainResolvers = []
        }
      }
      res.on('finish', onFinish)
      res.on('close', onFinish)
      next()
    }
  }

  /** Mount /health/live and /health/ready endpoints at the root (no API prefix) */
  private mountHealthEndpoints(): void {
    this.app.get('/health/live', (_req, res) => {
      if (this._draining) {
        res.status(503).json({ status: 'draining', uptime: process.uptime() })
      } else {
        res.json({ status: 'ok', uptime: process.uptime() })
      }
    })

    this.app.get('/health/ready', async (_req, res) => {
      if (this._draining) {
        res.status(503).json({ status: 'draining', checks: [] })
        return
      }
      const adaptersWithHealth = this.adapters.filter((a) => a.onHealthCheck)
      const checks = await Promise.allSettled(adaptersWithHealth.map((a) => a.onHealthCheck!()))
      const results = checks.map((c, i) => {
        if (c.status === 'fulfilled') return c.value
        return { name: adaptersWithHealth[i].name ?? 'unknown', status: 'down' as const }
      })
      const healthy = results.every((r) => r.status === 'up')
      res.status(healthy ? 200 : 503).json({
        status: healthy ? 'ready' : 'degraded',
        checks: results,
      })
    })
  }
}
