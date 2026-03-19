import http from 'node:http'
import express, { type Express, type RequestHandler } from 'express'
import {
  Container,
  createLogger,
  type AppModuleClass,
  type AppAdapter,
  type AdapterMiddleware,
} from '@kickjs/core'
import { buildRoutes } from './router-builder'
import { requestId } from './middleware/request-id'
import { notFoundHandler, errorHandler } from './middleware/error-handler'

const log = createLogger('Application')

/**
 * A middleware entry in the declarative pipeline.
 * Can be a bare handler or an object with path scoping.
 */
export type MiddlewareEntry =
  | RequestHandler
  | { path: string; handler: RequestHandler }

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

  /** Express `trust proxy` setting */
  trustProxy?: boolean | number | string | ((ip: string, hopIndex: number) => boolean)
  /** Maximum JSON body size (only used when middleware is not provided) */
  jsonLimit?: string | number
}

/**
 * The main application class. Wires together Express, the DI container,
 * feature modules, adapters, and the middleware pipeline.
 */
export class Application {
  private app: Express
  private container: Container
  private httpServer: http.Server | null = null
  private adapters: AppAdapter[]

  constructor(private readonly options: ApplicationOptions) {
    this.app = express()
    this.container = Container.getInstance()
    this.adapters = options.adapters ?? []
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
  setup(): void {
    log.info('Bootstrapping application...')

    // Collect adapter middleware by phase
    const adapterMw = this.collectAdapterMiddleware()

    // ── 1. Adapter beforeMount hooks ──────────────────────────────────
    for (const adapter of this.adapters) {
      adapter.beforeMount?.(this.app, this.container)
    }

    // ── 2. Hardened defaults ──────────────────────────────────────────
    this.app.disable('x-powered-by')
    this.app.set('trust proxy', this.options.trustProxy ?? false)

    // ── 3. Adapter middleware: beforeGlobal ───────────────────────────
    this.mountMiddlewareList(adapterMw.beforeGlobal)

    // ── 4. Global middleware ─────────────────────────────────────────
    if (this.options.middleware) {
      // User-declared pipeline — full control
      for (const entry of this.options.middleware) {
        this.mountMiddlewareEntry(entry)
      }
    } else {
      // Sensible defaults when no middleware declared
      this.app.use(requestId())
      this.app.use(express.json({ limit: this.options.jsonLimit ?? '100kb' }))
    }

    // ── 5. Adapter middleware: afterGlobal ────────────────────────────
    this.mountMiddlewareList(adapterMw.afterGlobal)

    // ── 6. Module registration + DI bootstrap ────────────────────────
    const modules = this.options.modules.map((ModuleClass) => {
      const mod = new ModuleClass()
      mod.register(this.container)
      return mod
    })
    this.container.bootstrap()

    // ── 7. Adapter middleware: beforeRoutes ───────────────────────────
    this.mountMiddlewareList(adapterMw.beforeRoutes)

    // ── 8. Mount module routes with versioning ───────────────────────
    const apiPrefix = this.options.apiPrefix ?? '/api'
    const defaultVersion = this.options.defaultVersion ?? 1

    for (const mod of modules) {
      const result = mod.routes()
      const routeSets = Array.isArray(result) ? result : [result]

      for (const route of routeSets) {
        const version = route.version ?? defaultVersion
        const mountPath = `${apiPrefix}/v${version}${route.path}`
        this.app.use(mountPath, route.router)

        // Notify adapters (e.g. SwaggerAdapter for OpenAPI spec generation)
        if (route.controller) {
          for (const adapter of this.adapters) {
            adapter.onRouteMount?.(route.controller, mountPath)
          }
        }
      }
    }

    // ── 9. Adapter middleware: afterRoutes ────────────────────────────
    this.mountMiddlewareList(adapterMw.afterRoutes)

    // ── 10. Error handlers ───────────────────────────────────────────
    this.app.use(notFoundHandler())
    this.app.use(errorHandler())

    // ── 11. Adapter beforeStart hooks ────────────────────────────────
    for (const adapter of this.adapters) {
      adapter.beforeStart?.(this.app, this.container)
    }
  }

  /** Start the HTTP server, retrying up to 3 times on port conflict */
  start(): void {
    this.setup()

    const basePort = this.options.port ?? parseInt(process.env.PORT || '3000', 10)
    const maxRetries = 3

    const tryListen = (port: number, attempt: number) => {
      this.httpServer = http.createServer(this.app)

      this.httpServer.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && attempt < maxRetries) {
          const nextPort = port + 1
          log.warn(`Port ${port} in use, trying ${nextPort}... (${attempt + 1}/${maxRetries})`)
          tryListen(nextPort, attempt + 1)
        } else {
          throw err
        }
      })

      this.httpServer.listen(port, () => {
        if (port !== basePort) {
          log.warn(`Port ${basePort} was in use, using ${port} instead`)
        }
        log.info(`Server running on http://localhost:${port}`)

        for (const adapter of this.adapters) {
          adapter.afterStart?.(this.httpServer!, this.container)
        }
      })
    }

    tryListen(basePort, 0)
  }

  /** HMR rebuild: swap Express handler without restarting the server */
  rebuild(): void {
    // Reset the DI container so singletons are re-created with fresh code
    Container.reset()
    this.container = Container.getInstance()

    this.app = express()
    this.setup()

    if (this.httpServer) {
      this.httpServer.removeAllListeners('request')
      this.httpServer.on('request', this.app)
      log.info('HMR: Express app rebuilt and swapped')
    }
  }

  /** Graceful shutdown — runs all adapter shutdowns in parallel, resilient to failures */
  async shutdown(): Promise<void> {
    log.info('Shutting down...')

    // Run all adapter shutdowns concurrently — don't let one failure block the rest
    const results = await Promise.allSettled(
      this.adapters.map((adapter) => Promise.resolve(adapter.shutdown?.())),
    )
    for (const result of results) {
      if (result.status === 'rejected') {
        log.error({ err: result.reason }, 'Adapter shutdown failed')
      }
    }

    if (this.httpServer) {
      await new Promise<void>((resolve) => this.httpServer!.close(() => resolve()))
    }
  }

  getExpressApp(): Express {
    return this.app
  }

  getHttpServer(): http.Server | null {
    return this.httpServer
  }

  // ── Internal helpers ────────────────────────────────────────────────

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
}
