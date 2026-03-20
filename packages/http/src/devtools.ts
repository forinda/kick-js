import type { Request, Response, NextFunction } from 'express'
import { Router } from 'express'
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
 * import { DevToolsAdapter } from '@forinda/kickjs-http/devtools'
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

    // Dashboard UI — self-contained HTML that polls JSON endpoints
    router.get('/', (_req: Request, res: Response) => {
      res.type('html').send(this.renderDashboard())
    })

    app.use(this.basePath, router)
    log.info(`DevTools mounted at ${this.basePath}`)
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

  private renderDashboard(): string {
    const base = this.basePath
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>KickJS DevTools</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; padding: 24px; }
  h1 { font-size: 24px; margin-bottom: 8px; color: #38bdf8; }
  .subtitle { color: #64748b; font-size: 14px; margin-bottom: 24px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .card { background: #1e293b; border-radius: 12px; padding: 20px; border: 1px solid #334155; }
  .card h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 1px; color: #94a3b8; margin-bottom: 12px; }
  .stat { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #334155; }
  .stat:last-child { border-bottom: none; }
  .stat-label { color: #94a3b8; }
  .stat-value { font-weight: 600; font-variant-numeric: tabular-nums; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; }
  .badge-green { background: #065f46; color: #6ee7b7; }
  .badge-red { background: #7f1d1d; color: #fca5a5; }
  .badge-blue { background: #1e3a5f; color: #93c5fd; }
  .badge-yellow { background: #713f12; color: #fcd34d; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; padding: 8px; color: #94a3b8; border-bottom: 2px solid #334155; font-weight: 600; }
  td { padding: 8px; border-bottom: 1px solid #1e293b; }
  .method { font-weight: 700; font-size: 11px; }
  .method-get { color: #34d399; }
  .method-post { color: #60a5fa; }
  .method-put { color: #fbbf24; }
  .method-delete { color: #f87171; }
  .method-patch { color: #a78bfa; }
  .refresh-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
  .refresh-info { font-size: 12px; color: #64748b; }
  .pulse { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #34d399; margin-right: 6px; animation: pulse 2s infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
  .empty { color: #64748b; font-style: italic; padding: 12px 0; }
</style>
</head>
<body>
<h1>⚡ KickJS DevTools</h1>
<div class="refresh-bar">
  <div class="subtitle">Development introspection dashboard</div>
  <div class="refresh-info"><span class="pulse"></span>Auto-refresh every 30s · <span id="lastUpdate">loading...</span></div>
</div>

<div class="grid">
  <div class="card">
    <h2>Health</h2>
    <div id="health"><div class="empty">Loading...</div></div>
  </div>
  <div class="card">
    <h2>Metrics</h2>
    <div id="metrics"><div class="empty">Loading...</div></div>
  </div>
  <div class="card">
    <h2>WebSocket</h2>
    <div id="ws"><div class="empty">Loading...</div></div>
  </div>
</div>

<div class="card" style="margin-bottom: 16px;">
  <h2>Routes (<span id="routeCount">0</span>)</h2>
  <div id="routes" style="overflow-x: auto;"><div class="empty">Loading...</div></div>
</div>

<div class="card">
  <h2>DI Container (<span id="diCount">0</span>)</h2>
  <div id="container" style="overflow-x: auto;"><div class="empty">Loading...</div></div>
</div>

<script>
const BASE = '${base}';
const POLL_MS = 30000;

async function fetchJSON(path) {
  try { const r = await fetch(BASE + path); return r.ok ? r.json() : null; } catch { return null; }
}

function stat(label, value) {
  return '<div class="stat"><span class="stat-label">' + label + '</span><span class="stat-value">' + value + '</span></div>';
}

function badge(text, type) {
  return '<span class="badge badge-' + type + '">' + text + '</span>';
}

function methodClass(m) { return 'method method-' + m.toLowerCase(); }

async function refresh() {
  const [health, metrics, routes, container, ws] = await Promise.all([
    fetchJSON('/health'), fetchJSON('/metrics'), fetchJSON('/routes'),
    fetchJSON('/container'), fetchJSON('/ws'),
  ]);

  if (health) {
    const statusBadge = health.status === 'healthy' ? badge('healthy', 'green') : badge('degraded', 'red');
    let html = stat('Status', statusBadge);
    html += stat('Uptime', formatDuration(health.uptime));
    html += stat('Error Rate', (health.errorRate * 100).toFixed(2) + '%');
    if (health.adapters) {
      Object.entries(health.adapters).forEach(function(e) {
        html += stat(e[0], badge(e[1], e[1] === 'running' ? 'green' : 'yellow'));
      });
    }
    document.getElementById('health').innerHTML = html;
  }

  if (metrics) {
    let html = stat('Total Requests', metrics.requests.toLocaleString());
    html += stat('Server Errors (5xx)', metrics.serverErrors);
    html += stat('Client Errors (4xx)', metrics.clientErrors);
    html += stat('Error Rate', (metrics.errorRate * 100).toFixed(2) + '%');
    html += stat('Uptime', formatDuration(metrics.uptimeSeconds));
    html += stat('Started', new Date(metrics.startedAt).toLocaleTimeString());
    document.getElementById('metrics').innerHTML = html;
  }

  if (ws) {
    if (!ws.enabled) {
      document.getElementById('ws').innerHTML = '<div class="empty">No WsAdapter</div>';
    } else {
      let html = stat('Active Connections', ws.activeConnections);
      html += stat('Total Connections', ws.totalConnections);
      html += stat('Messages In', ws.messagesReceived);
      html += stat('Messages Out', ws.messagesSent);
      html += stat('Errors', ws.errors);
      if (ws.namespaces) {
        Object.entries(ws.namespaces).forEach(function(e) {
          html += stat(e[0], e[1].connections + ' conn / ' + e[1].handlers + ' handlers');
        });
      }
      document.getElementById('ws').innerHTML = html;
    }
  }

  if (routes) {
    document.getElementById('routeCount').textContent = routes.routes.length;
    if (routes.routes.length === 0) {
      document.getElementById('routes').innerHTML = '<div class="empty">No routes registered</div>';
    } else {
      let html = '<table><tr><th>Method</th><th>Path</th><th>Controller</th><th>Handler</th><th>Middleware</th></tr>';
      routes.routes.forEach(function(r) {
        html += '<tr><td class="' + methodClass(r.method) + '">' + r.method + '</td>';
        html += '<td><code>' + r.path + '</code></td>';
        html += '<td>' + r.controller + '</td>';
        html += '<td>' + r.handler + '</td>';
        html += '<td>' + (r.middleware.length ? r.middleware.join(', ') : '—') + '</td></tr>';
      });
      html += '</table>';
      document.getElementById('routes').innerHTML = html;
    }
  }

  if (container) {
    document.getElementById('diCount').textContent = container.count;
    if (container.count === 0) {
      document.getElementById('container').innerHTML = '<div class="empty">No DI registrations</div>';
    } else {
      let html = '<table><tr><th>Token</th><th>Scope</th><th>Instantiated</th></tr>';
      container.registrations.forEach(function(r) {
        html += '<tr><td><code>' + r.token + '</code></td>';
        html += '<td>' + badge(r.scope, 'blue') + '</td>';
        html += '<td>' + (r.instantiated ? badge('yes', 'green') : badge('no', 'yellow')) + '</td></tr>';
      });
      html += '</table>';
      document.getElementById('container').innerHTML = html;
    }
  }

  document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString();
}

function formatDuration(seconds) {
  if (seconds < 60) return seconds + 's';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ' + (seconds % 60) + 's';
  var h = Math.floor(seconds / 3600);
  var m = Math.floor((seconds % 3600) / 60);
  return h + 'h ' + m + 'm';
}

refresh();
setInterval(refresh, POLL_MS);
</script>
</body>
</html>`
  }
}
