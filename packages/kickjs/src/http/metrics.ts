/**
 * `/metrics` in the Prometheus text format: a request-duration histogram per
 * route pattern, plus process health (memory, heap, event-loop lag).
 *
 * @module @forinda/kickjs/http/metrics
 */
import { monitorEventLoopDelay } from 'node:perf_hooks'
import type { AppAdapter, AdapterContext } from '../core/adapter'
import type { ResponseInfo } from '../core/observers'
import { safeEqual } from '../core/web-crypto'
import type { RequestContext } from './context'

export interface MetricsOptions {
  /** Where to serve the metrics. Default `/metrics`. */
  path?: string
  /**
   * Require `Authorization: Bearer <token>` to read them. The endpoint is
   * mounted before the app's middleware (so a scraper doesn't need your
   * auth), which also means your auth doesn't cover it — set this unless
   * the port is only reachable by the scraper.
   */
  token?: string
  /** Histogram buckets, in seconds. Default: Prometheus' defaults, 5ms to 10s. */
  buckets?: number[]
}

const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]

/** Label values per the exposition format: backslash, quote and newline escaped. */
const label = (value: string) =>
  value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n')

interface Series {
  labels: string
  counts: number[]
  sum: number
  count: number
}

/** The request histogram, keyed by its label set. */
export class RequestHistogram {
  private readonly series = new Map<string, Series>()

  private readonly buckets: readonly number[]

  /**
   * Bounds in seconds — sorted and deduplicated here, since the exposition
   * format needs them strictly increasing; anything not a finite positive
   * number is rejected.
   */
  constructor(buckets: readonly number[] = DEFAULT_BUCKETS) {
    if (buckets.length === 0 || buckets.some((b) => !Number.isFinite(b) || b <= 0)) {
      throw new Error('metrics: buckets must be finite positive numbers (seconds)')
    }
    this.buckets = [...new Set(buckets)].toSorted((a, b) => a - b)
  }

  observe(info: Pick<ResponseInfo, 'method' | 'route' | 'status' | 'durationMs'>): void {
    // The route pattern, never the raw path: `/users/42` and `/users/43` are
    // one series, and a scan of random URLs adds one series (`unmatched`),
    // not one per URL.
    const labels =
      `method="${label(knownMethod(info.method))}",route="${label(info.route ?? 'unmatched')}",` +
      `status="${info.status}"`
    let series = this.series.get(labels)
    if (!series) {
      series = { labels, counts: this.buckets.map(() => 0), sum: 0, count: 0 }
      this.series.set(labels, series)
    }
    const seconds = info.durationMs / 1000
    for (const [i, bound] of this.buckets.entries()) if (seconds <= bound) series.counts[i]++
    series.sum += seconds
    series.count++
  }

  render(): string {
    const name = 'http_request_duration_seconds'
    const lines = [
      `# HELP ${name} Time to answer an HTTP request, by route pattern.`,
      `# TYPE ${name} histogram`,
    ]
    for (const s of this.series.values()) {
      for (const [i, bound] of this.buckets.entries()) {
        lines.push(`${name}_bucket{${s.labels},le="${bound}"} ${s.counts[i]}`)
      }
      lines.push(`${name}_bucket{${s.labels},le="+Inf"} ${s.count}`)
      lines.push(`${name}_sum{${s.labels}} ${s.sum}`)
      lines.push(`${name}_count{${s.labels}} ${s.count}`)
    }
    return lines.join('\n')
  }
}

const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'QUERY'])

/**
 * The method as a label, or `OTHER`. Node only parses known methods, but a
 * fetch-based host (Bun, Deno) passes any token through, and each one would
 * start a series.
 */
function knownMethod(method: string): string {
  const upper = method.toUpperCase()
  return METHODS.has(upper) ? upper : 'OTHER'
}

function gauge(name: string, help: string, value: number): string {
  return `# HELP ${name} ${help}\n# TYPE ${name} gauge\n${name} ${value}`
}

/**
 * Serve Prometheus metrics. Add it to `adapters`:
 *
 * ```ts
 * bootstrap({ modules, adapters: [metricsAdapter({ token: process.env.METRICS_TOKEN })] })
 * ```
 */
export function metricsAdapter(options: MetricsOptions = {}): AppAdapter {
  const path = options.path ?? '/metrics'
  const histogram = new RequestHistogram(options.buckets ?? DEFAULT_BUCKETS)
  const expected = options.token === undefined ? undefined : `Bearer ${options.token}`
  let loop: ReturnType<typeof monitorEventLoopDelay> | undefined

  const render = () => {
    const memory = process.memoryUsage()
    const lag = loop && loop.count > 0 ? loop.mean / 1e9 : 0
    return [
      histogram.render(),
      gauge('process_resident_memory_bytes', 'Resident set size.', memory.rss),
      gauge('nodejs_heap_used_bytes', 'V8 heap in use.', memory.heapUsed),
      gauge('nodejs_heap_total_bytes', 'V8 heap allocated.', memory.heapTotal),
      gauge('nodejs_eventloop_lag_seconds', 'Mean event-loop delay since the last scrape.', lag),
      gauge('process_uptime_seconds', 'Seconds since the process started.', process.uptime()),
    ].join('\n\n')
  }

  return {
    name: 'MetricsAdapter',
    beforeMount({ http }: AdapterContext) {
      loop = monitorEventLoopDelay({ resolution: 20 })
      loop.enable()
      http.route('GET', path, (ctx: RequestContext) => {
        const auth = ctx.headers.authorization
        if (expected && (typeof auth !== 'string' || !safeEqual(auth, expected))) {
          ctx.setHeader('WWW-Authenticate', 'Bearer')
          ctx.json({ message: 'Unauthorized' }, 401)
          return
        }
        const body = render()
        // Lag is "since the last scrape": start the next window now.
        loop?.reset()
        ctx.setHeader('Cache-Control', 'no-store')
        ctx.send(`${body}\n`, { type: 'text/plain; version=0.0.4; charset=utf-8' })
      })
    },
    onResponse(info: ResponseInfo) {
      // The scrape itself is not a request worth measuring.
      if (info.route === path) return
      histogram.observe(info)
    },
    shutdown() {
      loop?.disable()
    },
  }
}
