import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createReadStream, existsSync, readFileSync, statSync, unlink } from 'node:fs'
import { Readable } from 'node:stream'
import { randomBytes } from 'node:crypto'
import { writeHeapSnapshot } from 'node:v8'
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
  getRouteFlags,
  type MatchedRoute,
  type RequestContext,
} from '@forinda/kickjs'
import {
  MemoryAnalyzer,
  PROTOCOL_VERSION,
  RuntimeSampler,
  type IntrospectionSnapshot,
} from '@forinda/kickjs-devtools-kit'
import { DEVTOOLS_BUS } from '@forinda/kickjs-devtools-kit/bus/token'
import { collectTopologySnapshot, type TopologyApplicationLike } from './topology'
import { collectDevtoolsTabs } from './devtools-tabs'
import { createServerBus, type ServerBus } from './bus/server'

const log = createLogger('DevTools')

/** Route metadata collected during mount */
interface RouteInfo {
  method: string
  path: string
  controller: string
  handler: string
  middleware: string[]
  /**
   * Route flags in force, resolved method-over-class. Present so the dashboard
   * can answer "why is this endpoint not requiring auth" from the route list
   * itself, rather than by reading the controller.
   */
  flags: Record<string, unknown>
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

/**
 * Where every runtime publishes the matched route on the raw request — the
 * same `Symbol.for` slot `ctx.route` reads in `@forinda/kickjs`. Registry
 * symbol, so it is shared across module copies.
 */
const MATCHED_ROUTE_SLOT = Symbol.for('kick.route')

/** Compute a percentile from a sorted array of numbers */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.ceil(p * sorted.length) - 1
  return sorted[Math.max(0, idx)]
}

/** Compute p50, p95, p99 from a RouteStats samples buffer */
function computePercentiles(stats: RouteStats): { p50: number; p95: number; p99: number } {
  const sorted = [...stats.samples].toSorted((a, b) => a - b)
  return {
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
  }
}

/**
 * Race a promise against a timeout. Clears the timer when the inner
 * promise wins so we don't leak handles every time a peer responds
 * quickly. Used to bound peer `onHealthCheck()` calls inside the
 * `/_debug/health` handler — one slow peer must not be able to stall
 * the dashboard request.
 */
function raceWithTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

/**
 * Per-peer budget for `onHealthCheck()` inside `/_debug/health`.
 * Long enough for a typical DB ping or remote check, short enough that
 * one misbehaving adapter can't stall the dashboard endpoint.
 */
const PEER_HEALTHCHECK_TIMEOUT_MS = 1500

/**
 * Module-scoped guard for `POST /_debug/memory/snapshot`. `writeHeapSnapshot()`
 * blocks the event loop for the duration of the capture (multi-second
 * for large heaps); two concurrent captures would compound the pause.
 * The endpoint returns 503 + a hint message when this flag is set so
 * the SPA can surface a "snapshot already running" warning rather than
 * silently queueing.
 *
 * Module-scoped (not per-adapter-instance) because writeHeapSnapshot
 * acts on the V8 process — multiple DevToolsAdapter instances would
 * still race at the v8 layer.
 */
let snapshotInProgress = false

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

  /**
   * Tuning for the runtime sampler that powers `/_debug/runtime` and
   * the upcoming Memory tab (architecture.md §23). Defaults to
   * 1-second polling with a 60-sample (~1 minute) ring buffer.
   *
   * Set `runtime.enabled = false` to skip starting the sampler — the
   * `/_debug/runtime` endpoint then returns 404 instead of an empty
   * snapshot, signalling deliberate opt-out rather than a startup race.
   */
  runtime?: {
    /** Whether to start the runtime sampler at all. Default: true. */
    enabled?: boolean
    /** Polling interval in milliseconds. Default: 1000. */
    intervalMs?: number
    /** Ring-buffer size — number of past samples retained. Default: 60. */
    bufferSize?: number
  }
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
  /**
   * Tier-1 runtime sampler from `@forinda/kickjs-devtools-kit`. `null`
   * when `runtime.enabled` is `false`. Tests can `latest()` and
   * `history()` directly without going through the HTTP endpoint.
   */
  readonly runtimeSampler: RuntimeSampler | null
  /**
   * Memory analyzer fed by the runtime sampler. `null` when the
   * sampler is disabled. Use `analyzer.health(sampler.history())` to
   * compose a composite memory-health snapshot.
   */
  readonly memoryAnalyzer: MemoryAnalyzer | null
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

    // ── Runtime sampler + memory analyzer (kit) ────────────────────
    // Lazily instantiated so an adopter that disables runtime monitoring
    // doesn't pay the perf_hooks histogram cost. Lifecycle: start in
    // `beforeMount`, stop in `shutdown`.
    const runtimeEnabled = options.runtime?.enabled ?? true
    const runtimeSampler = runtimeEnabled
      ? new RuntimeSampler({
          intervalMs: options.runtime?.intervalMs ?? 1000,
          bufferSize: options.runtime?.bufferSize ?? 60,
        })
      : null
    const memoryAnalyzer = runtimeEnabled ? new MemoryAnalyzer() : null

    // ── Server-side event bus ──────────────────────────────────────
    // Lazily resolved in `beforeMount` — when the devtools adapter is
    // rebuilt during HMR, the same `Container` may already hold a bus
    // from a previous mount with live WebSocket clients + in-flight
    // subscriptions. Creating a fresh bus on every rebuild would
    // silently swap the registered instance, leaving plugins that
    // already captured the old reference publishing into a dead bus.
    // Using `container.has(DEVTOOLS_BUS)` to reuse instead keeps event
    // delivery stable across rebuilds.
    //
    // When the devtools adapter is disabled (`enabled === false`) we
    // register a no-op stub instead so adopters who Inject(DEVTOOLS_BUS)
    // under @Optional() get a callable instance rather than undefined.
    let bus: ServerBus | null = null

    const ensureBus = (container: Container): ServerBus => {
      if (container.has(DEVTOOLS_BUS)) {
        // The token is typed `KickEventBus` but the registered instance
        // is the wider `ServerBus` (KickEventBus + attachUpgrade /
        // close / clientCount). Explicit generic on resolve avoids the
        // structural-cast — Container.resolve's last overload accepts
        // an explicit T and returns it.
        bus = container.resolve<ServerBus>(DEVTOOLS_BUS)
        return bus
      }
      bus = enabled
        ? createServerBus({
            wsPath: `${basePath}/_bus`,
            secret: secret === false ? false : secret,
          })
        : ({
            on: () => () => {},
            onAny: () => () => {},
            emit: () => {},
            attachUpgrade: () => {},
            close: () => {},
            clientCount: () => 0,
          } as ServerBus)
      container.registerInstance(DEVTOOLS_BUS, bus)
      return bus
    }

    // ── Reactive state ─────────────────────────────────────────────
    const requestCount = ref(0)
    const errorCount = ref(0)
    const clientErrorCount = ref(0)
    // App mount timestamp — kept for reference, but uptime is derived from the
    // node process (see below) so it survives HMR rebuilds.
    const startedAt = ref(Date.now())
    const routeLatency = reactive<Record<string, RouteStats>>({})

    const errorRate = computed(() =>
      requestCount.value > 0 ? errorCount.value / requestCount.value : 0,
    )

    // Uptime is the NODE PROCESS uptime, not "time since beforeMount". In dev,
    // `beforeMount` re-runs on every HMR rebuild / SSR re-bootstrap, which used
    // to reset `startedAt` and pin uptime near 0s. `process.uptime()` is
    // monotonic from process start, so it reports the real server uptime across
    // reloads. `tick` makes the computed re-evaluate when the reactive graph
    // refreshes; the value itself comes from the live process clock.
    const uptimeSeconds = computed(() => {
      void startedAt.value // keep the dependency so DevTools polls re-read it
      return Math.floor(process.uptime())
    })

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

    /**
     * Find the dashboard's public directory. Prefers the new Solid SPA
     * (public/spa/, shipped from PR 4 of §23); falls back to the legacy
     * Vue+Tailwind dashboard (public/devtools/) for environments that
     * haven't run `pnpm --filter @forinda/kickjs-devtools build:spa`.
     */
    const resolvePublicDir = (): string | null => {
      const thisDir = dirname(fileURLToPath(import.meta.url))
      const candidates = [
        join(thisDir, '..', 'public', 'spa'), // dist/ -> public/spa
        join(thisDir, '..', '..', 'public', 'spa'), // src/ -> public/spa
        join(thisDir, '..', 'public', 'devtools'), // legacy Vue dashboard
        join(thisDir, '..', '..', 'public', 'devtools'), // legacy from src/
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

    /**
     * Active HTTP runtime identity + capabilities (`express` | `fastify` | `h3`),
     * read from the Application via `getActiveRuntime()`. Returns `null` when the
     * framework is older than the getter (graceful for mixed versions). Lets the
     * dashboard show which engine the app is running on.
     */
    const readActiveRuntime = (): {
      name: string
      capabilities: Record<string, boolean>
    } | null => {
      const kickApp = appRef?.__kickApp
      if (kickApp && typeof kickApp.getActiveRuntime === 'function') {
        try {
          return kickApp.getActiveRuntime()
        } catch {
          return null
        }
      }
      return null
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
      runtimeSampler,
      memoryAnalyzer,

      // ── DevTools introspection (architecture.md §23) ─────────────
      // Cheap snapshot — counters + flags only. Anything that requires
      // a container walk or DB hit belongs in the per-endpoint RPCs
      // (`/_debug/container`, `/_debug/graph`), not here.
      introspect(): IntrospectionSnapshot {
        return {
          protocolVersion: PROTOCOL_VERSION,
          name: 'DevToolsAdapter',
          kind: 'adapter',
          state: {
            basePath,
            enabled,
            runtimeEnabled,
            secret: secret === false ? false : 'present',
          },
          metrics: {
            requestCount: requestCount.value,
            serverErrors: errorCount.value,
            clientErrors: clientErrorCount.value,
            uptimeSeconds: uptimeSeconds.value,
            routesTracked: routes.length,
          },
        }
      },

      // ── Lifecycle ─────────────────────────────────────────────────

      beforeMount({ app, http, container: containerArg }) {
        if (!enabled) return

        appRef = app
        container = containerArg
        // Lazy resolve — reuses the existing bus when the same
        // container is reused across HMR rebuilds, otherwise creates
        // and registers a fresh instance. See `ensureBus` for why.
        ensureBus(containerArg)
        startedAt.value = Date.now()
        // Clear routes on rebuild/restart to prevent HMR duplication
        routes = []
        adapterStatuses['DevToolsAdapter'] = 'running'

        // Start the runtime sampler + memory analyzer here (rather than
        // at construction) so test harnesses that build the adapter but
        // never mount it don't leak interval timers.
        runtimeSampler?.start()
        memoryAnalyzer?.start()

        // Every dashboard route registers through the engine-agnostic HTTP
        // facade (`ctx.http`) and answers through `RequestContext`, so the
        // dashboard runs under Express, Fastify, and h3 alike. The dashboard
        // root (`'/'`) maps to `basePath` itself.
        //
        // The token guard runs inside each route rather than as a path-scoped
        // connect middleware: connect middleware sees the engine's raw
        // request, whose `path` / `query` differ per engine (and Express
        // strips the mount prefix while the others don't).
        const joinBase = (p: string): string => (p === '/' ? basePath : `${basePath}${p}`)
        const authorized = (ctx: RequestContext): boolean => {
          if (secret === false) return true
          const provided = ctx.headers['x-devtools-token'] ?? ctx.query?.token
          if (provided === secret) return true
          ctx.json({ error: 'Forbidden — invalid or missing devtools token' }, 403)
          return false
        }
        const guarded =
          (handler: (ctx: RequestContext) => unknown) =>
          (ctx: RequestContext): unknown =>
            authorized(ctx) ? handler(ctx) : undefined
        const router = {
          get: (path: string, handler: (ctx: RequestContext) => unknown): void =>
            http.route('GET', joinBase(path), guarded(handler)),
          post: (path: string, handler: (ctx: RequestContext) => unknown): void =>
            http.route('POST', joinBase(path), guarded(handler)),
        }

        router.get('/routes', (ctx: RequestContext) => {
          ctx.json({ routes })
        })

        router.get('/container', (ctx: RequestContext) => {
          const registrations = container?.getRegistrations() ?? []
          ctx.json({ registrations, count: registrations.length })
        })

        router.get('/metrics', (ctx: RequestContext) => {
          // Build latency with percentiles, omitting raw samples from response
          const latency: Record<string, any> = {}
          for (const [key, stats] of Object.entries(routeLatency)) {
            const { samples: _, ...rest } = stats
            latency[key] = { ...rest, ...computePercentiles(stats) }
          }
          ctx.json({
            requests: requestCount.value,
            serverErrors: errorCount.value,
            clientErrors: clientErrorCount.value,
            errorRate: errorRate.value,
            uptimeSeconds: uptimeSeconds.value,
            startedAt: new Date(startedAt.value).toISOString(),
            routeLatency: latency,
          })
        })

        router.get('/health', async (ctx: RequestContext) => {
          const healthy = errorRate.value < errorRateThreshold
          const status = healthy ? 'healthy' : 'degraded'

          // Refresh peer statuses from `onHealthCheck()` when present.
          // The static `adapterStatuses` dict (seeded in `afterStart`)
          // proves a peer was mounted; calling `onHealthCheck()` here
          // upgrades that to a live `up`/`down`/`degraded` reading so
          // the Overview > Health card reflects actual adapter state,
          // not just "registered at boot".
          //
          // Each peer call is bounded by `PEER_HEALTHCHECK_TIMEOUT_MS` —
          // an adapter whose check hangs (network DB ping, remote
          // service, etc.) must not be able to stall the entire
          // dashboard request. Timed-out peers fall through to the
          // catch arm and are reported as `down`.
          const live: Record<string, string> = { ...adapterStatuses }
          await Promise.all(
            getPeerAdapters().map(async (peer) => {
              if (typeof peer?.onHealthCheck !== 'function') return
              const name: unknown = peer?.name
              if (typeof name !== 'string' || name === 'DevToolsAdapter') return
              try {
                const result = await raceWithTimeout(
                  Promise.resolve(peer.onHealthCheck()),
                  PEER_HEALTHCHECK_TIMEOUT_MS,
                  `onHealthCheck(${name})`,
                )
                if (result && typeof result.status === 'string') {
                  live[name] = result.status
                }
              } catch {
                live[name] = 'down'
              }
            }),
          )

          ctx.json(
            {
              status,
              errorRate: errorRate.value,
              uptime: uptimeSeconds.value,
              runtime: readActiveRuntime(),
              adapters: live,
            },
            healthy ? 200 : 503,
          )
        })

        router.get('/state', (ctx: RequestContext) => {
          const wsAdapter = getPeerAdapters().find(
            (a) => a.name === 'WsAdapter' && typeof a.getStats === 'function',
          )
          ctx.json({
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

        // ── Tier-1 runtime monitoring (architecture.md §23) ─────────
        // Returns the latest RuntimeSnapshot + a composite MemoryHealth
        // computed from the sampler's ring buffer. Returns 404 when the
        // sampler is disabled so adopters can distinguish "off" from
        // "starting up".
        router.get('/runtime', (ctx: RequestContext) => {
          if (!runtimeSampler || !memoryAnalyzer) {
            ctx.json({ error: 'runtime sampler disabled — set runtime.enabled = true' }, 404)
            return
          }
          const latest = runtimeSampler.latest()
          const history = runtimeSampler.history()
          const health = memoryAnalyzer.health(history)
          ctx.json({
            protocolVersion: PROTOCOL_VERSION,
            // Identity of the process these stats describe — every memory / CPU /
            // event-loop number below is for THIS Node process (the one running
            // your KickJS app), not the OS or any child. Lets the panel label it
            // unambiguously ("Node v22 · pid 12345 · linux/x64 · engine: fastify").
            process: {
              nodeVersion: process.version,
              pid: process.pid,
              platform: process.platform,
              arch: process.arch,
              runtime: readActiveRuntime(),
            },
            latest,
            history,
            health,
          })
        })

        // ── SSE: live runtime snapshots (architecture.md §23) ───────
        // Pushes the latest RuntimeSnapshot every `intervalMs`. SSE
        // (not WebSocket) avoids the http.Server `upgrade`-event
        // coordination cost — see devtools-flows.md §3 for rationale.
        router.get('/runtime/stream', (ctx: RequestContext) => {
          if (!runtimeSampler) {
            ctx.json({ error: 'runtime sampler disabled' }, 404)
            return
          }
          const sse = ctx.sse()
          const intervalMs = options.runtime?.intervalMs ?? 1000
          const tick = (): void => {
            const snap = runtimeSampler.latest()
            if (snap) sse.send(snap)
          }
          tick()
          const interval = setInterval(tick, intervalMs)
          const heartbeat = setInterval(() => sse.comment('heartbeat'), 30_000)
          sse.onClose(() => {
            clearInterval(interval)
            clearInterval(heartbeat)
          })
        })

        // ── SSE: memory health composite (architecture.md §23) ──────
        router.get('/memory/stream', (ctx: RequestContext) => {
          if (!runtimeSampler || !memoryAnalyzer) {
            ctx.json({ error: 'runtime sampler disabled' }, 404)
            return
          }
          const sse = ctx.sse()
          const intervalMs = options.runtime?.intervalMs ?? 1000
          const tick = (): void => {
            const snap = runtimeSampler.latest()
            if (!snap) return
            const health = memoryAnalyzer.health(runtimeSampler.history())
            sse.send({ snapshot: snap, health })
          }
          tick()
          const interval = setInterval(tick, intervalMs)
          const heartbeat = setInterval(() => sse.comment('heartbeat'), 30_000)
          sse.onClose(() => {
            clearInterval(interval)
            clearInterval(heartbeat)
          })
        })

        // ── Heap snapshot — Tier 3 monitoring (architecture.md §23) ─
        // POST /_debug/memory/snapshot — captures a V8 heap snapshot
        // and streams the resulting .heapsnapshot file back as
        // application/json with Content-Disposition. Snapshot capture
        // blocks the event loop while writing (multi-second pause for
        // large heaps), so the endpoint enforces single-flight via a
        // module-scoped flag — concurrent calls return 503.
        //
        // The file streams through `ctx.sendResponse` (engine-neutral, with
        // backpressure — never buffered whole) and the temp file is deleted
        // once the response completes, fails, or the client disconnects.
        // Worst case if the process dies mid-snapshot is a stranded file in
        // `os.tmpdir()`, which the OS cleans up on next boot.
        router.post('/memory/snapshot', async (ctx: RequestContext) => {
          if (snapshotInProgress) {
            ctx.json({ error: 'heap snapshot already in progress — wait for it to complete' }, 503)
            return
          }
          snapshotInProgress = true
          const startedAt = Date.now()
          const filename = `kickjs-heap-${new Date().toISOString().replace(/[:.]/g, '-')}.heapsnapshot`
          const targetPath = join(tmpdir(), filename)

          let written: string
          try {
            // writeHeapSnapshot is synchronous — the event loop is
            // blocked for the duration. There's no async variant in
            // the v8 module today; if one ships, swap here.
            written = writeHeapSnapshot(targetPath)
          } catch (err) {
            snapshotInProgress = false
            log.error({ err }, 'heap snapshot capture failed')
            ctx.json({ error: 'snapshot capture failed', message: (err as Error).message }, 500)
            return
          }

          let size = 0
          try {
            size = statSync(written).size
          } catch {
            /* size header is best-effort */
          }
          const elapsedMs = Date.now() - startedAt
          log.info(
            `Heap snapshot captured: ${written} (${(size / 1024 / 1024).toFixed(1)} MiB in ${elapsedMs}ms)`,
          )

          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'X-Snapshot-Capture-Ms': String(elapsedMs),
          }
          if (size > 0) headers['Content-Length'] = String(size)

          const stream = createReadStream(written)
          try {
            await ctx.sendResponse(
              new Response(Readable.toWeb(stream) as ReadableStream, { headers }),
            )
          } catch (err) {
            log.error({ err }, 'heap snapshot stream failed')
          } finally {
            // Also covers a client that disconnected mid-download:
            // sendResponse stops reading, so close the file here.
            stream.destroy()
            unlink(written, (err) => {
              if (err) log.warn(`Failed to delete heap snapshot ${written}: ${err.message}`)
              snapshotInProgress = false
            })
          }
        })

        // ── Force GC — Tier 3 monitoring (architecture.md §23) ──────
        // POST /_debug/memory/gc — calls `global.gc()` if Node was
        // started with --expose-gc, returning before/after heap size
        // so the panel can show how much was reclaimed. Useful for
        // confirming "is this growth real or just delayed GC?".
        //
        // Returns 412 Precondition Failed (with hint) when the flag
        // wasn't set, so the SPA can show "Run with --expose-gc to
        // enable this button" instead of a generic 5xx.
        router.post('/memory/gc', (ctx: RequestContext) => {
          const gc = (globalThis as { gc?: () => void }).gc
          if (typeof gc !== 'function') {
            ctx.json(
              {
                error:
                  'global.gc unavailable — start Node with --expose-gc to enable this endpoint',
              },
              412,
            )
            return
          }
          const before = process.memoryUsage().heapUsed
          const startedAt = Date.now()
          try {
            gc()
          } catch (err) {
            ctx.json(
              {
                error: 'forced GC failed',
                message: err instanceof Error ? err.message : String(err),
              },
              500,
            )
            return
          }
          const after = process.memoryUsage().heapUsed
          const reclaimedBytes = Math.max(0, before - after)
          const elapsedMs = Date.now() - startedAt
          log.info(
            `Forced GC reclaimed ${(reclaimedBytes / 1024 / 1024).toFixed(2)} MiB in ${elapsedMs}ms`,
          )
          ctx.json({ before, after, reclaimedBytes, elapsedMs })
        })

        // ── Custom-tab discovery (architecture.md §23) ──────────────
        // Walks every plugin/adapter `devtoolsTabs?()` contribution
        // and serves the deduped + validated list. The SPA fetches
        // this once at boot to render dynamic tabs after the four
        // built-ins.
        router.get('/tabs', (ctx: RequestContext) => {
          const kickApp = appRef?.__kickApp as TopologyApplicationLike | undefined
          if (!kickApp) {
            ctx.json({ error: 'tabs unavailable — application surface not exposed' }, 503)
            return
          }
          ctx.json(collectDevtoolsTabs(kickApp))
        })

        // ── Topology RPC (architecture.md §23) ──────────────────────
        // Aggregates plugins + adapters + contributors + DI tokens
        // into one snapshot; calls each primitive's introspect() in
        // parallel with a per-call timeout so a misbehaving adapter
        // can't block the endpoint. Errors are collected, not thrown.
        router.get('/topology', async (ctx: RequestContext) => {
          if (!container) {
            ctx.json({ error: 'topology unavailable — container not bound yet' }, 503)
            return
          }
          const kickApp = appRef?.__kickApp as TopologyApplicationLike | undefined
          if (!kickApp) {
            ctx.json({ error: 'topology unavailable — application surface not exposed' }, 503)
            return
          }
          try {
            const snapshot = await collectTopologySnapshot({ app: kickApp, container })
            ctx.json(snapshot)
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            ctx.json({ error: 'topology collection failed', message }, 500)
          }
        })

        router.get('/ws', (ctx: RequestContext) => {
          const wsAdapter = getPeerAdapters().find(
            (a) => a.name === 'WsAdapter' && typeof a.getStats === 'function',
          )
          if (!wsAdapter) {
            ctx.json({ enabled: false, message: 'WsAdapter not found' })
            return
          }
          ctx.json({ enabled: true, ...wsAdapter.getStats() })
        })

        router.get('/queues', async (ctx: RequestContext) => {
          const queueAdapter = getPeerAdapters().find(
            (a) => a.name === 'QueueAdapter' && typeof a.getQueueNames === 'function',
          )
          if (!queueAdapter) {
            ctx.json({ enabled: false, message: 'QueueAdapter not found' })
            return
          }
          try {
            const names: string[] = queueAdapter.getQueueNames?.() ?? []
            const queues: any[] = []
            for (const name of names) {
              const stats = await queueAdapter.getQueueStats?.(name)
              queues.push({ name, ...stats })
            }
            ctx.json({ enabled: true, queues })
          } catch {
            ctx.json({ enabled: true, queues: [], error: 'Failed to fetch queue stats' })
          }
        })

        // ── Dependency graph ────────────────────────────────────────
        router.get('/graph', (ctx: RequestContext) => {
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
          ctx.json({ nodes, edges })
        })

        // ── SSE stream for real-time updates ────────────────────────
        router.get('/stream', (ctx: RequestContext) => {
          const sse = ctx.sse()

          const sendMetrics = () => {
            sse.send({
              type: 'metrics',
              requestCount: requestCount.value,
              errorCount: errorCount.value,
              clientErrorCount: clientErrorCount.value,
              errorRate: errorRate.value,
              uptimeSeconds: uptimeSeconds.value,
            })
          }
          sendMetrics()

          const unsubContainer = container?.onChange?.((changes) => {
            sse.send({ type: 'container', changes, timestamp: Date.now() })
            sendMetrics()
          })

          const stopRequestWatch = watch(requestCount, () => sendMetrics())
          const stopErrWatch = watch(errorCount, () => sendMetrics())

          const heartbeat = setInterval(() => sse.comment('heartbeat'), 30000)

          sse.onClose(() => {
            unsubContainer?.()
            stopRequestWatch()
            stopErrWatch()
            clearInterval(heartbeat)
          })
        })

        if (exposeConfig) {
          router.get('/config', (ctx: RequestContext) => {
            const config: Record<string, string> = {}
            for (const [key, value] of Object.entries(process.env)) {
              if (value === undefined) continue
              const allowed = configPrefixes.some((prefix) => key.startsWith(prefix))
              config[key] = allowed ? value : '[REDACTED]'
            }
            ctx.json({ config })
          })
        }

        // Dashboard UI — Vue + Tailwind from public/devtools directory
        const publicDir = resolvePublicDir()
        // The page itself is not token-guarded — it loads first and sends the
        // token on its API calls — unless a `?token=` is given, which must match.
        const dashboard =
          (html: string) =>
          (ctx: RequestContext): unknown =>
            ctx.query?.token === undefined || authorized(ctx) ? ctx.html(html) : undefined
        if (publicDir) {
          // Serve only the SPA's `assets/` statically, so the static server can
          // never answer the dashboard root with the raw `index.html` — the
          // route below owns it and injects `data-base`. The legacy Vue
          // dashboard keeps its files at the top level.
          const assetsDir = join(publicDir, 'assets')
          if (existsSync(assetsDir)) http.serveStatic(`${basePath}/assets`, assetsDir)
          else http.serveStatic(basePath, publicDir)

          const indexHtml = readFileSync(join(publicDir, 'index.html'), 'utf-8')
          http.route(
            'GET',
            basePath,
            dashboard(indexHtml.replace('<body', `<body data-base="${basePath}"`)),
          )
        } else {
          http.route('GET', basePath, dashboard('<h1>DevTools: public directory not found</h1>'))
        }

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
            // Connect-style, so it sees the engine's raw Node request/response
            // on every runtime. The matched route comes from the slot each
            // runtime publishes on the request (`ctx.route` reads the same slot).
            handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => {
              const start = Date.now()
              requestCount.value++

              res.on('finish', () => {
                if (res.statusCode >= 500) errorCount.value++
                else if (res.statusCode >= 400) clientErrorCount.value++

                // Bucket unmatched paths (404s) under a single key. The
                // previous `?? req.path` fallback used the raw URL, which
                // grows the reactive map unboundedly under 404 probing —
                // each random path became its own entry, bloating
                // `/_debug/metrics` and leaking memory.
                const matched = (req as unknown as Record<symbol, MatchedRoute | undefined>)[
                  MATCHED_ROUTE_SLOT
                ]
                const routeKey = `${req.method} ${matched?.path ?? '<unmatched>'}`
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
            flags: Object.fromEntries(getRouteFlags(controllerClass, route.handlerName)),
          })
        }
      },

      afterStart({ server }) {
        if (!enabled) return
        // Wire the bus's WS upgrade to the framework's http.Server.
        // Path-based routing inside attachUpgrade means kickjs-ws or
        // any other adapter sharing the same listener stays
        // unaffected — only `${basePath}/_bus` is claimed.
        if (server) bus?.attachUpgrade(server)

        // Seed `/_debug/health.adapters` with every peer the framework
        // mounted alongside us. Before this, only `DevToolsAdapter`
        // appeared in the Overview > Health card because the dict was
        // only ever written in `beforeMount` (self) and `shutdown`
        // (self). Peers with `onHealthCheck` get their live status;
        // anything else is reported as `running` since reaching
        // `afterStart` means the framework already mounted them.
        for (const peer of getPeerAdapters()) {
          const name = peer?.name
          if (typeof name !== 'string' || name === 'DevToolsAdapter') continue
          adapterStatuses[name] = 'running'
        }

        log.info(
          `DevTools ready — ${routes.length} routes tracked, ` +
            `${container?.getRegistrations().length ?? 0} DI bindings, ` +
            `event bus on ${basePath}/_bus`,
        )
      },

      shutdown() {
        stopErrorWatch?.()
        runtimeSampler?.stop()
        memoryAnalyzer?.stop()
        bus?.close()
        adapterStatuses['DevToolsAdapter'] = 'stopped'
      },
    }
  },
})
