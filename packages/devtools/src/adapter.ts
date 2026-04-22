import type { Request, Response, NextFunction } from 'express'
import { Router, static as serveStatic } from 'express'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import {
  type AdapterMiddleware,
  type Container,
  METADATA,
  defineAdapter,
  ref,
  computed,
  reactive,
  watch,
  createLogger,
  type Ref,
  type ComputedRef,
  getClassMeta,
  getMethodMeta,
} from '@forinda/kickjs'

const log = createLogger('DevTools')

/** Route metadata collected during mount */
interface RouteInfo {
  method: string
  path: string
  controller: string
  handler: string
  middleware: string[]
}

/** Per-route latency stats with percentile tracking */
interface RouteStats {
  count: number
  totalMs: number
  minMs: number
  maxMs: number
  /** Ring buffer of last N samples for percentile computation */
  samples: number[]
}

const MAX_SAMPLES = 1000

/** Compute a percentile from a sorted array of numbers */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.ceil(p * sorted.length) - 1
  return sorted[Math.max(0, idx)]
}

/** Compute p50, p95, p99 from a RouteStats samples buffer */
function computePercentiles(stats: RouteStats): { p50: number; p95: number; p99: number } {
  const sorted = [...stats.samples].sort((a, b) => a - b)
  return {
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
  }
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
   * DevToolsAdapter({ secret: getEnv('DEVTOOLS_SECRET') })
   * ```
   */
  secret?: string | false
}

/**
 * Public reactive surface exposed by a DevToolsAdapter instance —
 * counters, computed metrics, and the route latency map. Tests and
 * peer adapters consume these directly to drive their own behavior.
 */
export interface DevToolsAdapterExtensions {
  /** Total requests received. */
  readonly requestCount: Ref<number>
  /** Total responses with status >= 500. */
  readonly errorCount: Ref<number>
  /** Total responses with status >= 400 and < 500. */
  readonly clientErrorCount: Ref<number>
  /** Server start time. */
  readonly startedAt: Ref<number>
  /** Computed error rate (server errors / total requests). */
  readonly errorRate: ComputedRef<number>
  /** Computed uptime in seconds. */
  readonly uptimeSeconds: ComputedRef<number>
  /** Per-route latency tracking. */
  readonly routeLatency: Record<string, RouteStats>
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
 *     DevToolsAdapter({
 *       enabled: process.env.NODE_ENV !== 'production',
 *       exposeConfig: true,
 *       configPrefixes: ['APP_', 'DATABASE_'],
 *     }),
 *   ],
 * })
 * ```
 */
export const DevToolsAdapter = defineAdapter<DevToolsOptions, DevToolsAdapterExtensions>({
  name: 'DevToolsAdapter',
  defaults: {
    basePath: '/_debug',
    errorRateThreshold: 0.5,
    exposeConfig: false,
    configPrefixes: ['APP_', 'NODE_ENV'],
  },
  build: (options) => {
    const basePath = options.basePath!
    const enabled = options.enabled ?? process.env.NODE_ENV !== 'production'
    const exposeConfig = options.exposeConfig!
    const configPrefixes = options.configPrefixes!
    const errorRateThreshold = options.errorRateThreshold!
    const peerAdapters = options.adapters ?? []

    // Secret token guard
    let secret: string | false
    if (options.secret === false) {
      secret = false
    } else if (options.secret) {
      secret = options.secret
    } else {
      secret = randomBytes(16).toString('hex')
    }

    // ── Reactive state ─────────────────────────────────────────────
    const requestCount = ref(0)
    const errorCount = ref(0)
    const clientErrorCount = ref(0)
    const startedAt = ref(Date.now())
    const routeLatency = reactive<Record<string, RouteStats>>({})

    const errorRate = computed(() =>
      requestCount.value > 0 ? errorCount.value / requestCount.value : 0,
    )

    const uptimeSeconds = computed(() => Math.floor((Date.now() - startedAt.value) / 1000))

    // ── Internal mutable state ─────────────────────────────────────
    let routes: RouteInfo[] = []
    let container: Container | null = null
    let appRef: any = null
    const adapterStatuses: Record<string, string> = {}
    let stopErrorWatch: (() => void) | null = null

    // Watch error rate — log warnings when elevated
    if (options.onErrorRateExceeded) {
      const callback = options.onErrorRateExceeded
      stopErrorWatch = watch(errorRate, (rate) => {
        if (rate > errorRateThreshold) {
          callback(rate)
        }
      })
    } else {
      stopErrorWatch = watch(errorRate, (rate) => {
        if (rate > errorRateThreshold) {
          log.warn(`Error rate elevated: ${(rate * 100).toFixed(1)}%`)
        }
      })
    }

    /** Find the public/devtools directory relative to the built dist or source */
    const resolvePublicDir = (): string | null => {
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

    /**
     * Resolve peer adapters at request time. Prefers live adapters from the
     * Application registry (survives HMR rebuild) and falls back to the
     * constructor-provided refs.
     */
    const getPeerAdapters = (): any[] => {
      const kickApp = appRef?.__kickApp
      if (kickApp && typeof kickApp.getAdapters === 'function') {
        return kickApp.getAdapters()
      }
      return peerAdapters
    }

    return {
      // ── Extensions (TExtra) ───────────────────────────────────────
      requestCount,
      errorCount,
      clientErrorCount,
      startedAt,
      errorRate,
      uptimeSeconds,
      routeLatency,

      // ── Lifecycle ─────────────────────────────────────────────────

      beforeMount({ app, container: containerArg }) {
        if (!enabled) return

        appRef = app
        container = containerArg
        startedAt.value = Date.now()
        // Clear routes on rebuild/restart to prevent HMR duplication
        routes = []
        adapterStatuses['DevToolsAdapter'] = 'running'

        const router = Router()

        // ── Access guard — require secret token ──────────────────
        if (secret !== false) {
          const token = secret
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
          res.json({ routes })
        })

        router.get('/container', (_req: Request, res: Response) => {
          const registrations = container?.getRegistrations() ?? []
          res.json({ registrations, count: registrations.length })
        })

        router.get('/metrics', (_req: Request, res: Response) => {
          // Build latency with percentiles, omitting raw samples from response
          const latency: Record<string, any> = {}
          for (const [key, stats] of Object.entries(routeLatency)) {
            const { samples: _, ...rest } = stats
            latency[key] = { ...rest, ...computePercentiles(stats) }
          }
          res.json({
            requests: requestCount.value,
            serverErrors: errorCount.value,
            clientErrors: clientErrorCount.value,
            errorRate: errorRate.value,
            uptimeSeconds: uptimeSeconds.value,
            startedAt: new Date(startedAt.value).toISOString(),
            routeLatency: latency,
          })
        })

        router.get('/health', (_req: Request, res: Response) => {
          const healthy = errorRate.value < errorRateThreshold
          const status = healthy ? 'healthy' : 'degraded'

          res.status(healthy ? 200 : 503).json({
            status,
            errorRate: errorRate.value,
            uptime: uptimeSeconds.value,
            adapters: adapterStatuses,
          })
        })

        router.get('/state', (_req: Request, res: Response) => {
          const wsAdapter = getPeerAdapters().find(
            (a) => a.name === 'WsAdapter' && typeof a.getStats === 'function',
          )
          res.json({
            reactive: {
              requestCount: requestCount.value,
              errorCount: errorCount.value,
              clientErrorCount: clientErrorCount.value,
              errorRate: errorRate.value,
              uptimeSeconds: uptimeSeconds.value,
              startedAt: new Date(startedAt.value).toISOString(),
            },
            routes: routes.length,
            container: container?.getRegistrations().length ?? 0,
            routeLatency,
            ...(wsAdapter ? { ws: wsAdapter.getStats() } : {}),
          })
        })

        router.get('/ws', (_req: Request, res: Response) => {
          const wsAdapter = getPeerAdapters().find(
            (a) => a.name === 'WsAdapter' && typeof a.getStats === 'function',
          )
          if (!wsAdapter) {
            res.json({ enabled: false, message: 'WsAdapter not found' })
            return
          }
          res.json({ enabled: true, ...wsAdapter.getStats() })
        })

        router.get('/queues', async (_req: Request, res: Response) => {
          const queueAdapter = getPeerAdapters().find(
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

        // ── Dependency graph ────────────────────────────────────────
        router.get('/graph', (_req: Request, res: Response) => {
          const registrations = container?.getRegistrations() ?? []
          const nodes = registrations
            .filter((r) => !r.token.startsWith('__hmr__'))
            .map((r) => ({
              id: r.token,
              kind: r.kind,
              scope: r.scope,
              resolveCount: r.resolveCount,
            }))
          const nodeIds = new Set(nodes.map((n) => n.id))
          const edges: Array<{ from: string; to: string }> = []
          for (const r of registrations) {
            if (r.token.startsWith('__hmr__')) continue
            for (const dep of r.dependencies) {
              if (nodeIds.has(dep)) {
                edges.push({ from: r.token, to: dep })
              }
            }
          }
          res.json({ nodes, edges })
        })

        // ── SSE stream for real-time updates ────────────────────────
        router.get('/stream', (req: Request, res: Response) => {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          })

          const sendMetrics = () => {
            const data = {
              type: 'metrics',
              requestCount: requestCount.value,
              errorCount: errorCount.value,
              clientErrorCount: clientErrorCount.value,
              errorRate: errorRate.value,
              uptimeSeconds: uptimeSeconds.value,
            }
            res.write(`data: ${JSON.stringify(data)}\n\n`)
          }
          sendMetrics()

          const unsubContainer = container?.onChange?.((changes) => {
            res.write(
              `data: ${JSON.stringify({ type: 'container', changes, timestamp: Date.now() })}\n\n`,
            )
            sendMetrics()
          })

          const stopRequestWatch = watch(requestCount, () => sendMetrics())
          const stopErrWatch = watch(errorCount, () => sendMetrics())

          const heartbeat = setInterval(() => {
            res.write(`: heartbeat\n\n`)
          }, 30000)

          req.on('close', () => {
            unsubContainer?.()
            stopRequestWatch()
            stopErrWatch()
            clearInterval(heartbeat)
          })
        })

        if (exposeConfig) {
          router.get('/config', (_req: Request, res: Response) => {
            const config: Record<string, string> = {}
            for (const [key, value] of Object.entries(process.env)) {
              if (value === undefined) continue
              const allowed = configPrefixes.some((prefix) => key.startsWith(prefix))
              config[key] = allowed ? value : '[REDACTED]'
            }
            res.json({ config })
          })
        }

        // Dashboard UI — Vue + Tailwind from public/devtools directory
        const publicDir = resolvePublicDir()
        if (publicDir) {
          router.use(serveStatic(publicDir))

          const indexHtml = readFileSync(join(publicDir, 'index.html'), 'utf-8')
          router.get('/', (_req: Request, res: Response) => {
            const html = indexHtml.replace('<body', `<body data-base="${basePath}"`)
            res.type('html').send(html)
          })
        } else {
          router.get('/', (_req: Request, res: Response) => {
            res.type('html').send('<h1>DevTools: public directory not found</h1>')
          })
        }

        app.use(basePath, router)

        if (secret) {
          log.info(`DevTools mounted at ${basePath} [token: ${secret}]`)
          log.info(`Access: ${basePath}?token=${secret}`)
        } else {
          log.info(`DevTools mounted at ${basePath} [no guard]`)
        }
      },

      middleware(): AdapterMiddleware[] {
        if (!enabled) return []

        return [
          {
            handler: (req: Request, res: Response, next: NextFunction) => {
              const start = Date.now()
              requestCount.value++

              res.on('finish', () => {
                if (res.statusCode >= 500) errorCount.value++
                else if (res.statusCode >= 400) clientErrorCount.value++

                const routeKey = `${req.method} ${req.route?.path ?? req.path}`
                const elapsed = Date.now() - start

                if (!routeLatency[routeKey]) {
                  routeLatency[routeKey] = {
                    count: 0,
                    totalMs: 0,
                    minMs: Infinity,
                    maxMs: 0,
                    samples: [],
                  }
                }
                const stats = routeLatency[routeKey]
                stats.count++
                stats.totalMs += elapsed
                stats.minMs = Math.min(stats.minMs, elapsed)
                stats.maxMs = Math.max(stats.maxMs, elapsed)
                stats.samples.push(elapsed)
                if (stats.samples.length > MAX_SAMPLES) stats.samples.shift()
              })

              next()
            },
            phase: 'beforeGlobal',
          },
        ]
      },

      onRouteMount(controllerClass, mountPath) {
        if (!enabled) return

        const collectedRoutes = getClassMeta<
          Array<{ method: string; path: string; handlerName: string }>
        >(METADATA.ROUTES, controllerClass, [])

        const classMiddleware = getClassMeta<any[]>(METADATA.CLASS_MIDDLEWARES, controllerClass, [])

        for (const route of collectedRoutes) {
          const methodMiddleware = getMethodMeta<any[]>(
            METADATA.METHOD_MIDDLEWARES,
            controllerClass.prototype,
            route.handlerName,
            [],
          )

          routes.push({
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
      },

      afterStart() {
        if (!enabled) return
        log.info(
          `DevTools ready — ${routes.length} routes tracked, ` +
            `${container?.getRegistrations().length ?? 0} DI bindings`,
        )
      },

      shutdown() {
        stopErrorWatch?.()
        adapterStatuses['DevToolsAdapter'] = 'stopped'
      },
    }
  },
})
