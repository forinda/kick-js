import http from 'node:http'
import express, { type Express, type RequestHandler } from 'express'
import {
  Container,
  createLogger,
  Logger,
  joinPaths,
  buildMountPath,
  tokenName,
  METADATA,
  type AppModule,
  type AppModuleClass,
  type AppModuleEntry,
  type AppAdapter,
  type AdapterContext,
  type AdapterMiddleware,
  type ContributorRegistrations,
  type KickPlugin,
  type ModuleRegistry,
  type RouteDefinition,
  type SourcedRegistration,
  mountSort,
  MutableModuleRegistry,
} from '../core'
import { moduleRouteMissingControllerError } from '../core/kick-errors'
import {
  disposeAll,
  drainDisposables,
  registerDisposable,
  runDisposables,
} from '../core/disposables'
import { getClassMeta } from '../core/metadata'
import { requestId } from './middleware/request-id'
import { notFoundHandler, errorHandler, type MountedRoute } from './middleware/error-handler'
import { requestScopeMiddleware, isRequestScopeMiddleware } from './middleware/request-scope'
import {
  _setExternalContributorSources,
  assertRouteUnique,
  buildRouteTable,
} from './router-builder'
import { HEALTH_PROBE, healthModule } from './health-module'
import { expressRuntime } from './runtimes/express'
import type {
  ActiveRuntime,
  AdapterHttp,
  HttpRuntime,
  RouteEntry,
  RuntimeCapabilities,
  RuntimeResponse,
} from './runtime'
import { requestStore } from './request-store'

const log = createLogger('Application')

/**
 * A middleware entry in the declarative pipeline.
 * Can be a bare handler or an object with path scoping.
 */
export type MiddlewareEntry = RequestHandler | { path: string; handler: RequestHandler }

/** Options for {@link Application.shutdown}. */
export interface ShutdownOptions {
  /**
   * Close the HTTP server and drain in-flight requests. Default `true`.
   *
   * Set `false` for a dev HMR rebuild, where the server is shared across
   * reloads — adapters, plugins, and disposables are still torn down, which is
   * the part a reload needs.
   */
  closeServer?: boolean
}

export interface ApplicationOptions {
  /**
   * Feature modules to load. Accepts both class form
   * (`SomeModule extends AppModule`, instantiated via `new`) and
   * instance form (output of {@link defineModule}'s factory call,
   * e.g. `TasksModule({ scope: 'admin' })`) — the loader discriminates
   * and either `new`-s the class or uses the instance directly.
   *
   * Static path — for conditional / dynamic registration, use the
   * {@link ApplicationOptions.setup} callback instead.
   */
  modules: AppModuleEntry[]

  /**
   * Imperative module registration callback. Receives a
   * {@link ModuleRegistry} you call `.mount(module)` on to register
   * modules conditionally — based on env flags, runtime config, a
   * tenant list, etc. Runs after every plugin's `setup()` hook and
   * after the static `modules: [...]` array is collected.
   *
   * @example
   * ```ts
   * bootstrap({
   *   modules: [HelloModule()],
   *   setup(registry) {
   *     if (env.ENABLE_ADMIN) registry.mount(AdminModule())
   *   },
   * })
   * ```
   */
  setup?(registry: ModuleRegistry): void
  /** Adapters that hook into the lifecycle (DB, Redis, Swagger, etc.) */
  adapters?: AppAdapter[]
  /** Server port (falls back to PORT env var, then 3000) */
  port?: number
  /** Global API prefix (default: '/api'). Pass `''` to mount at the root. */
  apiPrefix?: string
  /**
   * Default API version (default: 1) — routes become /{prefix}/v{version}/{path}.
   *
   * `false` opts out of URL versioning: routes mount at /{prefix}/{path}.
   * A module can still version itself by setting `version` on its
   * `ModuleRoutes` — the per-mount value always wins over this default, in
   * either direction.
   */
  defaultVersion?: number | false

  /**
   * Global middleware pipeline. Declared in order.
   * Replaces the hardcoded middleware stack — you control exactly what runs.
   *
   * @example
   * ```ts
   * bootstrap({
   *   modules,
   *   middlewares: [
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
  middlewares?: MiddlewareEntry[]
  /**
   * @deprecated Use {@link ApplicationOptions.middlewares} (plural).
   * Kept as an alias for back-compat; `middlewares` wins when both are
   * set.
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
  contributors?: ContributorRegistrations

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
   *   from) and `RequestContext.set/get` throws. Use `'manual'` only when you
   *   genuinely intend to wrap requests in your own ALS frame (rare —
   *   multi-tenant adapters used to do this; post-Phase 3 they share
   *   the framework's frame instead).
   */
  contextStore?: 'auto' | 'manual'

  /**
   * Controls whether KickJS registers process-level handlers at bootstrap.
   *
   * - `'auto'` (default) — register `uncaughtException` /
   *   `unhandledRejection` loggers AND `SIGINT` / `SIGTERM` →
   *   `app.shutdown()` → `process.exit(0)`.
   * - `'errors-only'` — register the error loggers; skip the signal
   *   handlers. Use this when you have your own shutdown choreographer
   *   (OpenTelemetry SDK, Sentry, custom orchestrator) that calls
   *   `app.shutdown()` itself and you don't want two listeners racing
   *   to call `process.exit`.
   * - `'manual'` — skip everything. Adopter is responsible for both
   *   error logging and signal-driven shutdown.
   *
   * Background: many observability SDKs install their own SIGTERM
   * handler to flush spans/metrics before the process exits. Two
   * separate handlers calling `process.exit(0)` race each other and
   * can truncate the in-flight flush. Setting this to `'errors-only'`
   * or `'manual'` lets the SDK own the lifecycle while still letting
   * KickJS surface uncaught exceptions / rejections via the logger.
   *
   * The dev mode auto-detect (`__kickjs_httpServer` set by the Vite
   * plugin) suppresses signal registration regardless of this option,
   * since Vite owns the lifecycle in development.
   */
  processHooks?: 'auto' | 'errors-only' | 'manual'

  /**
   * The HTTP engine driver. Defaults to {@link expressRuntime} — Express stays
   * the zero-config default, so existing apps are unaffected.
   *
   * Any `HttpRuntime` is accepted — pass `fastifyRuntime()` (from
   * `@forinda/kickjs/fastify`) or a custom engine driver. Defaults to
   * {@link expressRuntime}. The engine-native escape hatches
   * (`getRuntimeApp()`, `AdapterContext.app`) follow the active runtime via the
   * registry (`ActiveRuntime`, spec §4.3b) — Express by default, or the augmented
   * engine once the `kick/runtime` typegen output is present.
   */
  /**
   * Mount the built-in `GET /health/live` and `GET /health/ready`.
   *
   * On by default. Set `false` to take them over completely — supply your own
   * module at `/health` and nothing collides. The built-in is registered last,
   * so an app module claiming the same path already wins without this.
   *
   * They mount as an ordinary module, which means they sit inside the
   * middleware chain: whatever guards the rest of the app guards these too.
   * Exempt the path if your orchestrator must reach them unauthenticated.
   */
  health?: boolean

  runtime?: HttpRuntime

  /** Express `trust proxy` setting */
  trustProxy?: boolean | number | string | ((ip: string, hopIndex: number) => boolean)
  /** Maximum JSON body size (only used when middleware is not provided) */
  jsonLimit?: string | number
  /**
   * Print the route table on startup. Default: `false`. Set to `true`
   * to log a per-controller summary (method counts + mount paths) once
   * the app has mounted. Emitted at `info` level, so it is still subject
   * to `LOG_LEVEL` filtering (visible at the default `info`; hidden at
   * `warn`/`error`/`silent`).
   */
  logRouteTable?: boolean
  /**
   * @deprecated Use {@link ApplicationOptions.logRouteTable}. Kept as an
   * alias for back-compat; `logRouteTable` wins when both are set.
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
   * Custom 404 handler for unmatched routes. When omitted, the built-in
   * handler returns `{ message: 'Not Found' }` with status 404.
   *
   * Connect-**shaped**, not Express-**semantic** — see {@link onError} for the
   * per-runtime table. The same two caveats apply: `next()` is inert on
   * Fastify and h3, and Express-only request members (`req.originalUrl`,
   * `req.path`, `req.ip`) are `undefined` there, so read `req.url`.
   *
   * @example
   * ```ts
   * bootstrap({
   *   modules,
   *   onNotFound: (req, res) => {
   *     // `req.originalUrl` is Express-only — use `req.url` for portability.
   *     res.status(404).json({ error: 'Route not found', path: req.url })
   *   },
   * })
   * ```
   */
  onNotFound?: (req: any, res: RuntimeResponse, next: (err?: unknown) => void) => void

  /**
   * Custom global error handler, receiving `(err, req, res, next)`. When
   * omitted, the built-in handler formats ZodError, HttpException, and
   * unexpected errors.
   *
   * The shape is connect-style, but it is NOT "the standard Express error
   * handler" on every engine — what you actually receive differs, and the
   * differences bite:
   *
   * | | `req` | `res` | `next` |
   * | --- | --- | --- | --- |
   * | Express | native `Request` | native `Response` | real `next` |
   * | Fastify | `request.raw` | reply driver | **no-op** |
   * | h3 | `event.node.req` | response driver | no-op (or dev fall-through) |
   *
   * Two consequences worth knowing before you write one:
   *
   * - **`next(err)` does nothing on Fastify and h3.** It is a no-op function
   *   there, so delegating to the default handler silently drops the error.
   *   Send a response yourself rather than passing it on.
   * - **Express-only request members are `undefined` elsewhere.**
   *   `req.originalUrl`, `req.path`, and `req.ip` do not exist on the raw node
   *   request — use `req.url` and the `x-forwarded-*` headers, or reach for
   *   `ctx.ip` in a contributor / guard where a `RequestContext` is available.
   *
   * `res` is typed {@link RuntimeResponse} because that is what every engine
   * genuinely provides: `status`, `json`, `send`, `setHeader`, `render`,
   * `writeHead`, `end`. Express's own `Response` satisfies it.
   *
   * @example
   * ```ts
   * bootstrap({
   *   modules,
   *   onError: (err, req, res) => {
   *     logger.error(err, `${req.method} ${req.url}`) // not `originalUrl`
   *     res.status(err.status ?? 500).json({ error: err.message })
   *   },
   * })
   * ```
   */
  onError?: (err: any, req: any, res: RuntimeResponse, next: (err?: unknown) => void) => void

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

/**
 * A `defineModule()` factory, as opposed to a module class.
 *
 * Both are functions, so `typeof` cannot tell them apart. The factory carries a
 * frozen `definition` and a `scoped` helper, neither of which a class has.
 */
function isModuleFactory(entry: unknown): entry is (() => AppModule) & {
  definition: { name?: string; defaults?: unknown }
} {
  return (
    typeof entry === 'function' &&
    'definition' in entry &&
    typeof (entry as { scoped?: unknown }).scoped === 'function'
  )
}

/**
 * Whether a factory takes configuration.
 *
 * `defaults` is the only runtime signal that a module has config at all — the
 * type parameter is erased. Its presence is what separates "the bare name is
 * exactly equivalent" from "the bare name silently picked defaults for you".
 */
function isConfigurable(factory: { definition: { defaults?: unknown } }): boolean {
  const defaults = factory.definition?.defaults
  return defaults !== undefined && defaults !== null
}

/**
 * Resolve a module entry to an `AppModule`, whichever shape it arrives in.
 *
 * Three forms reach here: an instance (`defineModule(...)()` output), a legacy
 * module class, and — the case this exists for — a `defineModule()` factory
 * passed UNINVOKED. That last one used to hit `new factory()` and die with a
 * bare `TypeError: entry is not a constructor`, naming neither the module nor
 * the fix. It is easy to hit because the class form takes the bare name, so
 * the two styles look interchangeable and are not.
 *
 * For a module with NO config, calling the factory with no arguments produces
 * exactly what `Module()` would, so accepting the bare name is equivalent
 * rather than lenient.
 *
 * For a CONFIGURABLE module it is not equivalent in intent: the bare name
 * silently selects the defaults, and an author who meant `Module({ … })` would
 * get a running app wired the wrong way with nothing said. That is the failure
 * mode this whole change exists to remove, so those stay loud — with a message
 * that names the module and both correct spellings, rather than the bare
 * `entry is not a constructor` it used to produce.
 */
function toAppModule(entry: AppModuleEntry): AppModule {
  if (typeof entry !== 'function') return entry as AppModule
  if (isModuleFactory(entry)) {
    if (isConfigurable(entry)) {
      const name = entry.definition?.name || entry.name || '<anonymous>'
      throw new TypeError(
        `bootstrap: module \`${name}\` takes configuration, so it must be invoked.\n` +
          `  Write \`${name}()\` for its defaults, or \`${name}({ … })\` to configure it.\n` +
          `  Passing it bare would have silently selected the defaults.`,
      )
    }
    return entry()
  }

  const name = (entry as { name?: string }).name || '<anonymous>'
  if (!isConstructible(entry)) {
    throw new TypeError(
      `bootstrap: module entry \`${name}\` is a function, but not a module class ` +
        `and not a defineModule() factory (no \`definition\`).\n` +
        `  A defineModule() module is passed as \`${name}\` or \`${name}()\`; ` +
        `a class must implement AppModule.`,
    )
  }

  // Constructed OUTSIDE any catch. Wrapping this was masking real failures:
  // a legacy module whose constructor threw came back reported as "not a
  // module class", hiding the actual error and sending the reader to the
  // wrong place entirely.
  const mod = new (entry as AppModuleClass)() as AppModule

  // A plain `function Foo() {}` IS constructible and returns `{}`, so it
  // reaches here and would fail later inside the framework at `mod.routes()`
  // — a generic error, far from the entry that caused it. Check the shape
  // where the entry is still in hand.
  if (typeof mod?.routes !== 'function') {
    throw new TypeError(
      `bootstrap: module entry \`${name}\` constructed, but the result does not ` +
        `implement AppModule — \`routes()\` is missing.\n` +
        `  A module class needs \`routes()\`; a defineModule() module is passed ` +
        `as \`${name}\` or \`${name}()\`.`,
    )
  }
  return mod
}

/**
 * Whether `new fn()` is legal, without calling it.
 *
 * Reflect.construct with a deliberately unrelated `newTarget` performs the
 * constructibility check and then throws before running any constructor body,
 * so this stays side-effect free — which matters, because the whole point is
 * to avoid invoking something that may not be a constructor at all.
 */
function isConstructible(fn: unknown): boolean {
  try {
    Reflect.construct(String, [], fn as never)
    return true
  } catch {
    return false
  }
}

export class Application {
  private app: Express
  /** The HTTP engine driver. Defaults to {@link expressRuntime}. */
  private readonly runtime: HttpRuntime
  private container: Container
  private httpServer: http.Server | null = null
  private readonly adapters: AppAdapter[]

  private readonly plugins: KickPlugin[]

  /**
   * Snapshot of every module-level Context Contributor registration
   * captured during `setup()`. The registrations themselves are
   * frozen by `defineContextDecorator`, so storing references is
   * safe — they outlive the module instances they came from.
   *
   * Used by {@link getContributors} so DevTools and adopter tooling
   * can render the module-level contributors alongside the adapter /
   * plugin / global ones. Populated once per `setup()` call; cleared
   * at the start of each invocation so a re-setup (test harnesses,
   * dev-server restarts) doesn't accumulate stale entries.
   */
  private _moduleContributors: Array<{
    registration: { key: string; dependsOn: readonly string[] }
    label: string
  }> = []

  /** Number of HTTP requests currently being processed */
  private _inFlightRequests = 0
  /** Whether the application is draining (shutting down gracefully) */
  private _draining = false
  /** Whether shutdown has already been initiated (prevents double-shutdown) */
  private _shutdownInitiated = false
  /** Resolvers waiting for in-flight requests to reach zero */
  private _drainResolvers: Array<() => void> = []

  constructor(private readonly options: ApplicationOptions) {
    this.runtime = options.runtime ?? expressRuntime()
    // `this.app` is the engine-native app; typed Express here (the default) for
    // the legacy escape hatches. Under another runtime it holds that engine's
    // app — `getRuntimeApp()` / `AdapterContext.app` expose it via ActiveRuntime.
    this.app = this.runtime.createApp({ trustProxy: options.trustProxy }) as Express
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
    const handler = this.runtime.nodeHandler(this.app)
    if (next) {
      handler(req, res, next)
    } else {
      handler(req, res)
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
      http: this.adapterHttp(),
      app: this.app,
      container: this.container,
      server,
      env,
      isProduction: env === 'production',
    }
  }

  /**
   * The engine-agnostic HTTP surface handed to adapters as `ctx.http`. Each
   * call routes through the active runtime over the current `this.app`, so an
   * adapter written against this works under any runtime.
   */
  private adapterHttp(): AdapterHttp {
    return {
      route: (method, path, handler) => {
        const entry: RouteEntry = {
          method,
          path,
          middlewares: [],
          contributorRunner: null,
          handler,
          meta: {},
        }
        this.runtime.mountRoutes(this.app, [{ mountPath: '/', routes: [entry] }])
      },
      mount: (prefix, routes) => {
        this.runtime.mountRoutes(this.app, [{ mountPath: prefix, routes }])
      },
      serveStatic: (prefix, dir) => {
        this.runtime.serveStatic(this.app, prefix, dir)
      },
      use: (mw, opts) => {
        this.runtime.useConnect(this.app, mw, opts)
      },
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

    // Reset module-contributor snapshot at the very top of each
    // setup pass — before anything that could throw — so a partial
    // failure doesn't leave stale entries that getContributors()
    // would surface on the next call. See _moduleContributors field
    // declaration for the use case.
    this._moduleContributors = []

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
    // x-powered-by disable + trust proxy now live in `runtime.createApp()`.

    // ── 2a. In-flight request tracking ──────────────────────────────
    this.runtime.useConnect(this.app, this.requestTrackingMiddleware())

    // ── 2c. Request scope (AsyncLocalStorage) ────────────────────────
    // Auto-mounted unless the user opted out (`contextStore: 'manual'`)
    // or already included one in their middleware list.
    if (this.shouldAutoMountRequestScope()) {
      this.runtime.useConnect(this.app, requestScopeMiddleware())
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
          this.runtime.useConnect(this.app, handler)
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
        this.runtime.useConnect(this.app, helmetFn())
      } catch {
        // helmet middleware not available — skip silently
      }
    }

    const userMiddlewares = this.options.middlewares ?? this.options.middleware
    if (userMiddlewares) {
      // User-declared pipeline — full control
      for (const entry of userMiddlewares) {
        this.mountMiddlewareEntry(entry)
      }
    } else {
      // Sensible defaults when no middleware declared
      this.runtime.useConnect(this.app, requestId())
      // Skip express.json on engines that parse bodies natively (Fastify, h3) —
      // otherwise the body stream is read twice and the engine's parser hangs.
      if (!this.runtime.capabilities.nativeBodyParsing) {
        this.runtime.useConnect(this.app, express.json({ limit: this.options.jsonLimit ?? '1mb' }))
      }
    }

    // ── 5. Adapter middleware: afterGlobal ────────────────────────────
    this.mountMiddlewareList(adapterMw.afterGlobal)

    // ── 6. Module registration + DI bootstrap ────────────────────────
    // Module collection — the static `modules: [...]` array AND the
    // imperative `setup(registry)` callback feed into the same
    // ordered list. Plugins go first so plugin modules / setup
    // calls run before user code (existing precedence).
    //
    // Order within the registry:
    //   1. plugin static modules (`plugin.modules?()`)
    //   2. plugin setup() calls (in plugin dependsOn-sorted order)
    //   3. user static modules (`options.modules`)
    //   4. user setup() callback
    const moduleRegistry = new MutableModuleRegistry()
    for (const plugin of this.plugins) {
      for (const m of plugin.modules?.() ?? []) moduleRegistry.mount(m)
      plugin.setup?.(moduleRegistry)
    }
    for (const m of this.options.modules) moduleRegistry.mount(m)
    this.options.setup?.(moduleRegistry)

    // The built-in health endpoints, as an ordinary module. Registered last so
    // an app's own `/health` module wins by being mounted first, and skipped
    // entirely with `health: false`.
    //
    // The probe is bound before `register()` runs below, because the module's
    // factory resolves it. It closes over the Application rather than exposing
    // it: `isDraining` and `checks` are the whole surface the endpoints need,
    // so a replacement module can satisfy the same token.
    if (this.options.health !== false) {
      this.container.registerInstance(HEALTH_PROBE, {
        isDraining: () => this._draining,
        checks: async () => {
          const withCheck = this.adapters.filter((a) => a.onHealthCheck)
          const settled = await Promise.allSettled(withCheck.map((a) => a.onHealthCheck!()))
          return settled.map((c, i) =>
            c.status === 'fulfilled'
              ? c.value
              : { name: withCheck[i].name ?? 'unknown', status: 'down' as const },
          )
        },
      })
      moduleRegistry.mount(healthModule())
    }
    const allModuleEntries: AppModuleEntry[] = moduleRegistry.entries
    const modules = allModuleEntries.map((entry) => {
      const mod: AppModule = toAppModule(entry)
      // `register()` is optional — modules whose classes are entirely
      // decorator-managed (@Service, @Controller, @Repository) don't need it.
      mod.register?.(this.container)
      return mod
    })
    this.container.bootstrap()

    // Register Logger as an injectable singleton so @Inject(Logger)
    // works in constructors. Without this, Logger is just a plain
    // class with static methods and no DI binding.
    if (!this.container.has(Logger)) {
      this.container.registerInstance(Logger, new Logger())
    }

    // ── 7. Adapter middleware: beforeRoutes ───────────────────────────
    this.mountMiddlewareList(adapterMw.beforeRoutes)

    // ── 8. Mount module routes with versioning ───────────────────────
    const apiPrefix = this.options.apiPrefix ?? '/api'
    const defaultVersion = this.options.defaultVersion ?? 1
    // Opt-in, default off. `logRouteTable` is the current name;
    // `logRoutesTable` is the deprecated alias.
    const shouldLogRoutes = this.options.logRouteTable ?? this.options.logRoutesTable ?? false

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

    // Reset module-contributor snapshot at the start of each setup
    // pass so re-running `setup()` (test harnesses, dev-server
    // restarts) doesn't accumulate stale entries.
    this._moduleContributors = []

    // Duplicate-route guard (KICK006): one registry across every module in
    // this setup pass, so cross-module collisions fail at boot instead of
    // silently losing the dispatch race.
    const seenRoutes = new Map<string, string>()

    // Every path this app mounts, for the catch-all: a request that matches a
    // path but not its method is a 405, not a 404. Collected here because this
    // is the only place that knows the FULL mounted path — prefix, version and
    // controller route joined.
    const mountedPaths: MountedRoute[] = []

    for (const mod of modules) {
      // Prefer the declared `name` field (set by `defineModule({ name: 'X', ... })`)
      // over `constructor.name`. Factory-built modules are plain objects whose
      // constructor is `Object` — falling straight to `constructor.name` would
      // degrade every label in the DevTools Contributors table to "Object".
      const declaredName = (mod as { name?: unknown }).name
      const ctorName = mod.constructor?.name
      const moduleLabel =
        typeof declaredName === 'string' && declaredName.length > 0
          ? declaredName
          : ctorName && ctorName !== 'Object'
            ? ctorName
            : 'module'
      const moduleSources: SourcedRegistration[] = (mod.contributors?.() ?? []).map(
        (registration): SourcedRegistration => ({
          source: 'module',
          registration,
          label: moduleLabel,
        }),
      )
      // Retain registrations for `getContributors()` — these would
      // otherwise be unreachable post-bootstrap (module instances
      // are not kept on the Application).
      for (const src of moduleSources) {
        this._moduleContributors.push({
          registration: src.registration as { key: string; dependsOn: readonly string[] },
          label: moduleLabel,
        })
      }

      // Thread per-module + adapter + global sources to buildRoutes via the
      // module-scoped slot. Module setup is sequential, so the slot is
      // race-free. The slot MUST stay populated across both `mod.routes()`
      // AND any framework-driven `buildRoutes(controller)` calls below —
      // when a module returns `{ path, controller }` (auto-derive shape),
      // buildRoutes runs here, not inside routes(). Clearing the slot in
      // the routes()-finally would drop module/adapter/global contributors
      // on the floor and surface as `MissingContributorError` for any
      // class/method-level dependsOn referencing a module-level key.
      _setExternalContributorSources([...moduleSources, ...adapterSources, ...globalSources])
      try {
        const result = mod.routes()
        if (!result) continue // Non-HTTP modules (queues, cron) may return null

        const routeSets = Array.isArray(result) ? result : [result]

        for (const route of routeSets) {
          const version = route.version ?? defaultVersion
          // `prefix: false` mounts at the root — see ModuleRoutes.prefix.
          const mountPath = buildMountPath(
            route.prefix === false ? '' : apiPrefix,
            version,
            route.path,
          )
          // Common-case `{ path, controller }`: build the engine-neutral route
          // table and let the runtime materialize it natively (Express Router /
          // Fastify routes / …). Adopters who hand-build a `router` (composing
          // multiple controllers, third-party routers) pass it explicitly — that
          // is an Express-specific connect handler, mounted via `useConnect`.
          if (route.router) {
            this.runtime.useConnect(this.app, route.router, { path: mountPath })
          } else if (route.controller) {
            const routeTable = buildRouteTable(route.controller)
            const ctrl = route.controller.name ?? 'controller'
            for (const entry of routeTable) {
              // Per-handler owner so intra-controller duplicates name both methods.
              const owner = `${ctrl}.${String(entry.meta.handlerName ?? '?')}`
              const fullPath = joinPaths(mountPath, entry.path)
              assertRouteUnique(seenRoutes, entry.method, fullPath, owner)
              mountedPaths.push({ method: entry.method, path: fullPath })
            }
            this.runtime.mountRoutes(this.app, [{ mountPath, routes: routeTable }])
          } else {
            throw moduleRouteMissingControllerError(mountPath)
          }

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
      } finally {
        _setExternalContributorSources([])
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
      log.info('Routes:')

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
          .toSorted(([a], [b]) => methodRank(a) - methodRank(b))
          .map(([m, n]) => `${n} ${m}`)
          .join(', ')
        const name = controller.name || 'Controller'
        log.info(`  ${name.padEnd(30)} ${mountPath.padEnd(25)} ${defs.length} routes (${methods})`)
      }

      log.info(`  Total: ${totalRoutes} routes`)
    }

    // ── 9. Adapter middleware: afterRoutes ────────────────────────────
    this.mountMiddlewareList(adapterMw.afterRoutes)

    // ── 10. Adapter beforeStart hooks ────────────────────────────────
    // Runs BEFORE error handlers so adapters can still mount Express
    // routes (e.g. `McpAdapter` registers `/_mcp/messages` here). If
    // error handlers were registered first, the notFoundHandler — a
    // catch-all that never calls next() — would pre-empt anything an
    // adapter adds afterwards and adapter-mounted endpoints would 404.
    for (const adapter of this.adapters) {
      await this.callHook(adapter.beforeStart?.bind(adapter), ctx)
    }

    // ── 11. Error handlers ───────────────────────────────────────────
    // Last in the chain so any adapter-mounted route (step 10) gets
    // a chance to match before the catch-all 404 fires.
    // `onNotFound` / `onError` still win — the route table only sharpens the
    // DEFAULT, so an app that supplies its own catch-all is unaffected.
    this.runtime.setNotFound(this.app, this.options.onNotFound ?? notFoundHandler(mountedPaths))
    this.runtime.setErrorHandler(this.app, this.options.onError ?? errorHandler())
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

      // Dev mode suppresses our own SIGINT/SIGTERM handlers (Vite owns
      // the process lifecycle), so a Ctrl+C would otherwise skip graceful
      // shutdown entirely — `adapter.shutdown()`, request draining, and
      // any shutdown logs never run. Expose `shutdown()` on globalThis so
      // the CLI dev server (`kick dev`) can drive it before tearing down
      // Vite. Same process, so the CLI's signal handler can reach this.
      g.__kickjs_app_shutdown = () => this.shutdown()

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
    this.httpServer = http.createServer(this.runtime.nodeHandler(this.app))

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
    // Snapshot the outgoing app's disposables (session/rate-limit store
    // intervals) BEFORE setup() registers the incoming app's. On success the
    // stale set is disposed — without this, every HMR swap leaked one live
    // interval + Map per store. On failure it's restored, and whatever the
    // failed setup() half-registered is disposed instead.
    const staleDisposables = drainDisposables()

    try {
      Container.reset()
      this.container = Container.getInstance()
      this.app = this.runtime.createApp({ trustProxy: this.options.trustProxy }) as Express
      await this.setup()
    } catch (err) {
      log.error(err, 'HMR rebuild failed, keeping previous app')
      // Restore previous state so the server stays responsive
      await runDisposables(drainDisposables())
      for (const d of staleDisposables) registerDisposable(d)
      this.app = prevApp
      this.container = prevContainer
      return
    }

    await runDisposables(staleDisposables)

    if (this.httpServer) {
      this.httpServer.removeAllListeners('request')
      this.httpServer.on('request', this.runtime.nodeHandler(this.app))
      log.debug('HMR: app rebuilt and swapped')
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
  async shutdown(options: ShutdownOptions = {}): Promise<void> {
    // `closeServer: false` is the HMR reload path. In dev the HTTP server is
    // SHARED across rebuilds via `globalThis.__kickjs_httpServer`, so closing
    // it would kill the dev server on the first save — which is why the reload
    // path used to skip teardown entirely, leaking an adapter set per reload.
    // Everything below Step 2 is what a reload actually needs.
    const closeServer = options.closeServer ?? true
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
      if (closeServer && this.httpServer) {
        this.httpServer.close(() => {})
      }

      // Step 2: Wait for in-flight requests to drain (or timeout).
      // Skipped on a reload: the server keeps listening and the fresh app
      // takes over, so there is nothing to drain toward — waiting would just
      // stall the rebuild for up to `shutdownTimeout`.
      if (closeServer && this._inFlightRequests > 0) {
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

      // Step 3: Run all plugin + adapter shutdowns concurrently.
      //
      // Each hook is time-boxed INDIVIDUALLY. An unbounded `allSettled` here
      // means one hook that never settles wedges the whole shutdown, and on
      // the reload path that leaves the dev server with no app and no error —
      // it just stops rebuilding. Seen with a socket.io adapter calling
      // `io.close(cb)`: that callback fires only once every client
      // disconnects, so a single open browser tab hung every save forever.
      //
      // A reload gets a much shorter budget than a real shutdown — nobody
      // wants to wait `shutdownTimeout` (30s by default) per keystroke-save.
      // `shutdownTimeout: 0` means "no forced exit" for the drain above, so it
      // disables the per-hook budget too. Anything else would invert the
      // setting: `Math.min(0, 5_000)` is a ZERO-ms budget, which fires before
      // any hook can settle and silently skips every cleanup there is.
      const hookTimeoutMs = closeServer ? timeoutMs : Math.min(timeoutMs, 5_000)
      const timeBoxed = (label: string, run: () => unknown): Promise<unknown> => {
        // Invoke inside the promise: a hook that throws SYNCHRONOUSLY would
        // otherwise escape at the argument site, before `allSettled` wraps it,
        // taking down the whole teardown instead of just its own entry.
        const hook = (async () => run())()
        if (hookTimeoutMs <= 0) return hook
        return new Promise<unknown>((resolve, reject) => {
          const t = setTimeout(() => {
            log.warn(
              `${label} did not finish shutting down within ${hookTimeoutMs}ms — continuing without it. ` +
                `Its resources may still be held.`,
            )
            resolve(undefined)
          }, hookTimeoutMs)
          t.unref()
          // Clear on BOTH paths. `Promise.race` alone leaves the timer armed,
          // so a hook that finished promptly still logged a timeout warning
          // once the budget elapsed — on the reload path that is a false
          // accusation after every save.
          hook.then(
            (value) => {
              clearTimeout(t)
              resolve(value)
            },
            (err) => {
              clearTimeout(t)
              reject(err)
            },
          )
        })
      }

      const wasListening = this.httpServer?.listening === true
      const results = await Promise.allSettled([
        ...this.plugins.map((plugin) =>
          timeBoxed(`Plugin '${plugin.name}'`, () => plugin.shutdown?.()),
        ),
        ...this.adapters.map((adapter) =>
          timeBoxed(`Adapter '${adapter.name}'`, () => adapter.shutdown?.()),
        ),
      ])

      // A reload must leave the shared dev server listening. If a hook closed
      // it, every later request is ECONNREFUSED and the port never comes back
      // — with nothing in the log to say why. socket.io's `close()` does
      // exactly this: it closes the HTTP server it was constructed with.
      if (!closeServer && wasListening && this.httpServer?.listening === false) {
        log.error(
          'An adapter or plugin closed the shared HTTP server during an HMR reload. ' +
            'The dev server is now unreachable and will not rebind until you restart it. ' +
            "Close only what you own: socket.io's `io.close()` closes the HTTP server passed " +
            'to its constructor — on a reload, disconnect the sockets instead.',
        )
      }
      for (const result of results) {
        if (result.status === 'rejected') {
          log.error({ err: result.reason }, 'Adapter shutdown failed')
        }
      }

      // Step 4: Release framework-owned resources started outside the
      // adapter lifecycle — in-memory session/rate-limit store intervals —
      // and flush any pending container change batch so its debounce timer
      // doesn't outlive the app.
      await disposeAll()
      this.container.flushChanges()
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  /**
   * The engine-native app instance, typed from the active runtime
   * ({@link ActiveRuntime} — Express by default). Prefer this over
   * {@link getExpressApp}; under a non-Express runtime the type follows the
   * augmented registry.
   */
  getRuntimeApp(): ActiveRuntime['app'] {
    return this.app
  }

  /**
   * The active HTTP runtime's identity + capabilities — `name` is `'express'`
   * (default), `'fastify'`, or `'h3'`; `capabilities` reports what the engine
   * supports (render / uploads / connectMiddleware / nativeBodyParsing).
   * Surfaced by DevTools and the VS Code extension so tooling can show which
   * engine the app is running on. Cheap, side-effect free.
   */
  getActiveRuntime(): { name: string; capabilities: RuntimeCapabilities } {
    return { name: this.runtime.name, capabilities: this.runtime.capabilities }
  }

  /** @deprecated Use {@link getRuntimeApp}. Returns the engine-native app. */
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

  /**
   * Snapshot of every Context Contributor reachable from this app —
   * walks **four** registration sites: adapters, plugins, modules,
   * and the bootstrap `contributors` option. The devtools Topology
   * tab consumes this for the Contributors panel; tests + adopters
   * can call it for diagnostics.
   *
   * Per-route (method/class-decorator) registrations are NOT included
   * here — they live on the route registry rather than on any of
   * the four collection sites this method walks. A future RPC will
   * surface them separately.
   *
   * Result shape stays minimal — `{ key, source, label, dependsOn }`
   * — so we don't leak `resolve` closures or other internal fields.
   * `source` matches the five-level precedence union from
   * `ContributorSource` (minus `'method'` / `'class'` which require
   * the per-route walk noted above).
   */
  getContributors(): ReadonlyArray<{
    key: string
    source: 'module' | 'adapter' | 'plugin' | 'global'
    label: string
    dependsOn: readonly string[]
  }> {
    const out: Array<{
      key: string
      source: 'module' | 'adapter' | 'plugin' | 'global'
      label: string
      dependsOn: readonly string[]
    }> = []
    const ingest = (
      list: ReadonlyArray<unknown> | null | undefined,
      source: 'module' | 'adapter' | 'plugin' | 'global',
      label: string,
    ): void => {
      if (!list) return
      for (const reg of list) {
        const r = reg as { key?: unknown; dependsOn?: unknown }
        if (r.key === undefined || r.key === null) continue
        // `key` is typically a string but createToken<T>() yields a
        // branded token object — normalise via tokenName so both
        // surfaces flow through.
        const key = typeof r.key === 'string' ? r.key : tokenName(r.key)
        out.push({
          key,
          source,
          label,
          dependsOn: Array.isArray(r.dependsOn) ? (r.dependsOn as string[]) : [],
        })
      }
    }
    for (const adapter of this.adapters) {
      ingest(adapter.contributors?.(), 'adapter', adapter.name ?? 'adapter')
    }
    for (const plugin of this.plugins) {
      ingest(plugin.contributors?.(), 'plugin', plugin.name ?? 'plugin')
    }
    // Module-level registrations — captured during `setup()` because
    // module instances are not retained on the Application. Walk the
    // snapshot rather than calling `mod.contributors()` here.
    for (const { registration, label } of this._moduleContributors) {
      ingest([registration], 'module', label)
    }
    ingest(this.options.contributors, 'global', 'bootstrap')
    return out
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

    const userEntries = this.options.middlewares ?? this.options.middleware ?? []
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
      if (entry.path === undefined) {
        this.runtime.useConnect(this.app, entry.handler)
        continue
      }
      this.runtime.useConnect(this.app, entry.handler, { path: entry.path })
    }
  }

  private mountMiddlewareEntry(entry: MiddlewareEntry): void {
    if (typeof entry === 'function') {
      this.runtime.useConnect(this.app, entry)
    } else {
      this.runtime.useConnect(this.app, entry.handler, { path: entry.path })
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
}
