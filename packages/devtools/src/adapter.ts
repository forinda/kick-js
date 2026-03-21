import type { Request, Response, NextFunction } from 'express'
import { Router, static as serveStatic } from 'express'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import {
  type AppAdapter,
  type AdapterMiddleware,
  type Container,
  METADATA,
  ref,
  computed,
  reactive,
  watch,
  createLogger,
  type Ref,
  type ComputedRef,
} from '@forinda/kickjs-core'

const log = createLogger('DevTools')

/** Route metadata collected during mount */
interface RouteInfo {
  method: string
  path: string
  controller: string
  handler: string
  middleware: string[]
}

/** Per-route latency stats */
interface RouteStats {
  count: number
  totalMs: number
  minMs: number
  maxMs: number
}

export interface DevToolsOptions {
  /** Base path for debug endpoints (default: '/_debug') */
  basePath?: string
  /** Only enable when this is true (default: process.env.NODE_ENV !== 'production') */
  enabled?: boolean
  /** Include environment variables (sanitized) at /_debug/config (default: false) */
  exposeConfig?: boolean
  /** Env var prefixes to expose (default: ['APP_', 'NODE_ENV']). Others are redacted. */
  configPrefixes?: string[]
  /** Callback when error rate exceeds threshold */
  onErrorRateExceeded?: (rate: number) => void
  /** Error rate threshold (default: 0.5 = 50%) */
  errorRateThreshold?: number
  /** Other adapters to discover stats from (e.g., WsAdapter) */
  adapters?: any[]

  /**
   * Secret token to guard DevTools access. When set, all requests must
   * include this token as `x-devtools-token` header or `?token=` query param.
   *
   * Auto-generated on startup if not provided. The token is logged to the console.
   * Set to `false` to disable the guard entirely (not recommended).
   *
   * @example
   * ```ts
   * new DevToolsAdapter({ secret: process.env.DEVTOOLS_SECRET })
   * ```
   */
  secret?: string | false
}

/**
 * DevToolsAdapter — Vue-style reactive introspection for KickJS applications.
 *
 * Exposes debug endpoints powered by reactive state (ref, computed, watch):
 * - `GET /_debug/routes`    — all registered routes with middleware
 * - `GET /_debug/container` — DI registry with scopes and instantiation status
 * - `GET /_debug/metrics`   — live request/error counts, error rate, uptime
 * - `GET /_debug/health`    — deep health check with adapter status
 * - `GET /_debug/config`    — sanitized environment variables (opt-in)
 * - `GET /_debug/state`     — full reactive state snapshot
 *
 * @example
 * ```ts
 * import { DevToolsAdapter } from '@forinda/kickjs-devtools'
 *
 * bootstrap({
 *   modules: [UserModule],
 *   adapters: [
 *     new DevToolsAdapter({
 *       enabled: process.env.NODE_ENV !== 'production',
 *       exposeConfig: true,
 *       configPrefixes: ['APP_', 'DATABASE_'],
 *     }),
 *   ],
 * })
 * ```
 */
export class DevToolsAdapter implements AppAdapter {
  readonly name = 'DevToolsAdapter'

  private basePath: string
  private enabled: boolean
  private exposeConfig: boolean
  private configPrefixes: string[]
  private errorRateThreshold: number
  private secret: string | false

  // ── Reactive State ───────────────────────────────────────────────────
  /** Total requests received */
  readonly requestCount: Ref<number>
  /** Total responses with status >= 500 */
  readonly errorCount: Ref<number>
  /** Total responses with status >= 400 and < 500 */
  readonly clientErrorCount: Ref<number>
  /** Server start time */
  readonly startedAt: Ref<number>
  /** Computed error rate (server errors / total requests) */
  readonly errorRate: ComputedRef<number>
  /** Computed uptime in seconds */
  readonly uptimeSeconds: ComputedRef<number>
  /** Per-route latency tracking */
  readonly routeLatency: Record<string, RouteStats>

  // ── Internal State ───────────────────────────────────────────────────
  private routes: RouteInfo[] = []
  private container: Container | null = null
  private adapterStatuses: Record<string, string> = {}
  private stopErrorWatch: (() => void) | null = null
  private peerAdapters: any[] = []

  constructor(options: DevToolsOptions = {}) {
    this.basePath = options.basePath ?? '/_debug'
    this.enabled = options.enabled ?? process.env.NODE_ENV !== 'production'
    this.exposeConfig = options.exposeConfig ?? false
    this.configPrefixes = options.configPrefixes ?? ['APP_', 'NODE_ENV']
    this.errorRateThreshold = options.errorRateThreshold ?? 0.5
    this.peerAdapters = options.adapters ?? []

    // Secret token guard
    if (options.secret === false) {
      this.secret = false
    } else if (options.secret) {
      this.secret = options.secret
    } else {
      // Auto-generate a random token
      this.secret = randomBytes(16).toString('hex')
    }

    // Initialize reactive state
    this.requestCount = ref(0)
    this.errorCount = ref(0)
    this.clientErrorCount = ref(0)
    this.startedAt = ref(Date.now())
    this.routeLatency = reactive({})

    this.errorRate = computed(() =>
      this.requestCount.value > 0 ? this.errorCount.value / this.requestCount.value : 0,
    )

    this.uptimeSeconds = computed(() => Math.floor((Date.now() - this.startedAt.value) / 1000))

    // Watch error rate — log warnings when elevated
    if (options.onErrorRateExceeded) {
      const callback = options.onErrorRateExceeded
      const threshold = this.errorRateThreshold
      this.stopErrorWatch = watch(this.errorRate, (rate) => {
        if (rate > threshold) {
          callback(rate)
        }
      })
    } else {
      this.stopErrorWatch = watch(this.errorRate, (rate) => {
        if (rate > this.errorRateThreshold) {
          log.warn(`Error rate elevated: ${(rate * 100).toFixed(1)}%`)
        }
      })
    }
  }

  // ── Adapter Lifecycle ────────────────────────────────────────────────

  beforeMount(app: any, container: Container): void {
    if (!this.enabled) return

    this.container = container
    this.startedAt.value = Date.now()
    // Clear routes on rebuild/restart to prevent HMR duplication
    this.routes = []
    this.adapterStatuses[this.name] = 'running'

    const router = Router()

    // ── Access guard — require secret token ──────────────────────────
    if (this.secret !== false) {
      const token = this.secret
      router.use((req: Request, res: Response, next: NextFunction) => {
        const provided = req.headers['x-devtools-token'] ?? req.query?.token
        if (provided === token) return next()
        // Allow the dashboard HTML itself (it will include the token in API calls)
        if (req.path === '/' && req.method === 'GET' && !req.query?.token) {
          return next() // serve dashboard, it handles auth via token
        }
        // Serve static assets for the dashboard (js files)
        if (req.path.endsWith('.js') || req.path.endsWith('.css')) {
          return next()
        }
        res.status(403).json({ error: 'Forbidden — invalid or missing devtools token' })
      })
    }

    router.get('/routes', (_req: Request, res: Response) => {
      res.json({ routes: this.routes })
    })

    router.get('/container', (_req: Request, res: Response) => {
      const registrations = this.container?.getRegistrations() ?? []
      res.json({ registrations, count: registrations.length })
    })

    router.get('/metrics', (_req: Request, res: Response) => {
      res.json({
        requests: this.requestCount.value,
        serverErrors: this.errorCount.value,
        clientErrors: this.clientErrorCount.value,
        errorRate: this.errorRate.value,
        uptimeSeconds: this.uptimeSeconds.value,
        startedAt: new Date(this.startedAt.value).toISOString(),
        routeLatency: this.routeLatency,
      })
    })

    router.get('/health', (_req: Request, res: Response) => {
      const healthy = this.errorRate.value < this.errorRateThreshold
      const status = healthy ? 'healthy' : 'degraded'

      res.status(healthy ? 200 : 503).json({
        status,
        errorRate: this.errorRate.value,
        uptime: this.uptimeSeconds.value,
        adapters: this.adapterStatuses,
      })
    })

    router.get('/state', (_req: Request, res: Response) => {
      const wsAdapter = this.peerAdapters.find(
        (a) => a.name === 'WsAdapter' && typeof a.getStats === 'function',
      )
      res.json({
        reactive: {
          requestCount: this.requestCount.value,
          errorCount: this.errorCount.value,
          clientErrorCount: this.clientErrorCount.value,
          errorRate: this.errorRate.value,
          uptimeSeconds: this.uptimeSeconds.value,
          startedAt: new Date(this.startedAt.value).toISOString(),
        },
        routes: this.routes.length,
        container: this.container?.getRegistrations().length ?? 0,
        routeLatency: this.routeLatency,
        ...(wsAdapter ? { ws: wsAdapter.getStats() } : {}),
      })
    })

    router.get('/ws', (_req: Request, res: Response) => {
      const wsAdapter = this.peerAdapters.find(
        (a) => a.name === 'WsAdapter' && typeof a.getStats === 'function',
      )
      if (!wsAdapter) {
        res.json({ enabled: false, message: 'WsAdapter not found' })
        return
      }
      res.json({ enabled: true, ...wsAdapter.getStats() })
    })

    router.get('/queues', async (_req: Request, res: Response) => {
      const queueAdapter = this.peerAdapters.find(
        (a) => a.name === 'QueueAdapter' && typeof a.getQueueNames === 'function',
      )
      if (!queueAdapter) {
        res.json({ enabled: false, message: 'QueueAdapter not found' })
        return
      }
      try {
        const names: string[] = queueAdapter.getQueueNames?.() ?? []
        const queues: any[] = []
        for (const name of names) {
          const stats = await queueAdapter.getQueueStats?.(name)
          queues.push({ name, ...stats })
        }
        res.json({ enabled: true, queues })
      } catch {
        res.json({ enabled: true, queues: [], error: 'Failed to fetch queue stats' })
      }
    })

    if (this.exposeConfig) {
      router.get('/config', (_req: Request, res: Response) => {
        const config: Record<string, string> = {}
        for (const [key, value] of Object.entries(process.env)) {
          if (value === undefined) continue
          const allowed = this.configPrefixes.some((prefix) => key.startsWith(prefix))
          config[key] = allowed ? value : '[REDACTED]'
        }
        res.json({ config })
      })
    }

    // Dashboard UI — Vue + Tailwind from public/devtools directory
    const publicDir = this.resolvePublicDir()
    if (publicDir) {
      // Serve static assets (vue.global.min.js, tailwind-cdn.js)
      router.use(serveStatic(publicDir))

      // Serve index.html with base path injected
      const indexHtml = readFileSync(join(publicDir, 'index.html'), 'utf-8')
      router.get('/', (_req: Request, res: Response) => {
        // Inject basePath as data attribute for the Vue app
        const html = indexHtml.replace('<body', `<body data-base="${this.basePath}"`)
        res.type('html').send(html)
      })
    } else {
      router.get('/', (_req: Request, res: Response) => {
        res.type('html').send('<h1>DevTools: public directory not found</h1>')
      })
    }

    app.use(this.basePath, router)

    if (this.secret) {
      log.info(`DevTools mounted at ${this.basePath} [token: ${this.secret}]`)
      log.info(`Access: ${this.basePath}?token=${this.secret}`)
    } else {
      log.info(`DevTools mounted at ${this.basePath} [no guard]`)
    }
  }

  middleware(): AdapterMiddleware[] {
    if (!this.enabled) return []

    return [
      {
        handler: (req: Request, res: Response, next: NextFunction) => {
          const start = Date.now()
          this.requestCount.value++

          res.on('finish', () => {
            if (res.statusCode >= 500) this.errorCount.value++
            else if (res.statusCode >= 400) this.clientErrorCount.value++

            // Track per-route latency
            const routeKey = `${req.method} ${req.route?.path ?? req.path}`
            const elapsed = Date.now() - start

            if (!this.routeLatency[routeKey]) {
              this.routeLatency[routeKey] = {
                count: 0,
                totalMs: 0,
                minMs: Infinity,
                maxMs: 0,
              }
            }
            const stats = this.routeLatency[routeKey]
            stats.count++
            stats.totalMs += elapsed
            stats.minMs = Math.min(stats.minMs, elapsed)
            stats.maxMs = Math.max(stats.maxMs, elapsed)
          })

          next()
        },
        phase: 'beforeGlobal',
      },
    ]
  }

  onRouteMount(controllerClass: any, mountPath: string): void {
    if (!this.enabled) return

    const routes: Array<{ method: string; path: string; handlerName: string }> =
      Reflect.getMetadata(METADATA.ROUTES, controllerClass) ?? []

    const classMiddleware: any[] =
      Reflect.getMetadata(METADATA.CLASS_MIDDLEWARES, controllerClass) ?? []

    for (const route of routes) {
      const methodMiddleware: any[] =
        Reflect.getMetadata(
          METADATA.METHOD_MIDDLEWARES,
          controllerClass.prototype,
          route.handlerName,
        ) ?? []

      this.routes.push({
        method: route.method.toUpperCase(),
        path: `${mountPath}${route.path === '/' ? '' : route.path}`,
        controller: controllerClass.name,
        handler: route.handlerName,
        middleware: [
          ...classMiddleware.map((m: any) => m.name || 'anonymous'),
          ...methodMiddleware.map((m: any) => m.name || 'anonymous'),
        ],
      })
    }
  }

  afterStart(_server: any, _container: Container): void {
    if (!this.enabled) return
    log.info(
      `DevTools ready — ${this.routes.length} routes tracked, ` +
        `${this.container?.getRegistrations().length ?? 0} DI bindings`,
    )
  }

  shutdown(): void {
    this.stopErrorWatch?.()
    this.adapterStatuses[this.name] = 'stopped'
  }

  /** Find the public/devtools directory relative to the built dist or source */
  private resolvePublicDir(): string | null {
    // Try relative to this file's location (works in dist/)
    const thisDir = dirname(fileURLToPath(import.meta.url))
    const candidates = [
      join(thisDir, '..', 'public', 'devtools'), // dist/ -> public/devtools
      join(thisDir, '..', '..', 'public', 'devtools'), // src/ -> public/devtools
    ]
    for (const dir of candidates) {
      if (existsSync(join(dir, 'index.html'))) return dir
    }
    return null
  }
}
