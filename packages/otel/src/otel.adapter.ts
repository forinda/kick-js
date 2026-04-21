import {
  Logger,
  type AppAdapter,
  type AdapterContext,
  type AdapterMiddleware,
} from '@forinda/kickjs'
import type { Request, Response, NextFunction } from 'express'
import type { OtelAdapterOptions } from './types'

const log = Logger.for('OtelAdapter')

/**
 * OpenTelemetry adapter for KickJS — automatic tracing and metrics.
 *
 * Creates spans for each HTTP request with route, method, status code,
 * and duration. Optionally records request count and latency histograms.
 *
 * Works with any OTel-compatible backend: Jaeger, Grafana Tempo, Datadog,
 * Honeycomb, etc. Configure exporters via the OTel SDK before bootstrapping.
 *
 * @example
 * ```ts
 * import { OtelAdapter } from '@forinda/kickjs-otel'
 *
 * // Set up OTel SDK (e.g., with Jaeger exporter) before bootstrap
 * bootstrap({
 *   modules,
 *   adapters: [
 *     new OtelAdapter({
 *       serviceName: 'my-api',
 *       serviceVersion: '1.0.0',
 *       ignoreRoutes: ['/health', '/_debug/*'],
 *     }),
 *   ],
 * })
 * ```
 */
export class OtelAdapter implements AppAdapter {
  name = 'OtelAdapter'
  private options: Required<
    Pick<OtelAdapterOptions, 'serviceName' | 'serviceVersion' | 'tracing' | 'metrics'>
  > &
    OtelAdapterOptions
  private tracer: any = null
  private meter: any = null
  private requestCounter: any = null
  private requestDuration: any = null
  private readonly redact: (key: string, value: unknown) => unknown

  constructor(options: OtelAdapterOptions = {}) {
    this.options = {
      serviceName: options.serviceName ?? 'kickjs-app',
      serviceVersion: options.serviceVersion ?? '0.0.0',
      tracing: options.tracing ?? true,
      metrics: options.metrics ?? true,
      ...options,
    }
    this.redact = buildRedactor(this.options.sensitiveKeys, this.options.redactAttribute)
  }

  beforeStart({}: AdapterContext): void {
    try {
      // Dynamically import OTel API — it's a peer dependency
      const otelApi = require('@opentelemetry/api')

      if (this.options.tracing) {
        this.tracer = otelApi.trace.getTracer(this.options.serviceName, this.options.serviceVersion)
        log.info(`Tracing enabled for ${this.options.serviceName}`)
      }

      if (this.options.metrics) {
        this.meter = otelApi.metrics.getMeter(this.options.serviceName, this.options.serviceVersion)

        this.requestCounter = this.meter.createCounter('http.server.request.count', {
          description: 'Total number of HTTP requests',
        })

        this.requestDuration = this.meter.createHistogram('http.server.request.duration', {
          description: 'HTTP request duration in milliseconds',
          unit: 'ms',
        })

        log.info('Metrics enabled — http.server.request.count, http.server.request.duration')
      }
    } catch {
      log.warn(
        'OpenTelemetry API not found. Install @opentelemetry/api to enable tracing and metrics.',
      )
    }
  }

  middleware(): AdapterMiddleware[] {
    return [
      {
        handler: (req: Request, res: Response, next: NextFunction) => {
          // Skip ignored routes
          if (this.shouldIgnore(req.path)) {
            return next()
          }

          const startTime = performance.now()

          // Start a span if tracing is enabled
          let span: any = null
          if (this.tracer) {
            const otelApi = require('@opentelemetry/api')
            span = this.tracer.startSpan(`${req.method} ${req.route?.path ?? req.path}`, {
              attributes: this.applyRedaction({
                'http.method': req.method,
                'http.url': req.originalUrl,
                'http.target': req.path,
                'http.user_agent': req.get('user-agent') ?? '',
                'net.host.name': req.hostname,
                ...(this.options.customAttributes?.(req) ?? {}),
              }),
            })

            // Set span on context so downstream code can add attributes
            const ctx = otelApi.trace.setSpan(otelApi.context.active(), span)
            otelApi.context.with(ctx, () => {
              this.onFinish(req, res, startTime, span)
              next()
            })
            return
          }

          this.onFinish(req, res, startTime, null)
          next()
        },
        phase: 'beforeGlobal',
      },
    ]
  }

  private onFinish(req: Request, res: Response, startTime: number, span: any): void {
    res.on('finish', () => {
      const duration = performance.now() - startTime
      const route = (req as any).route?.path ?? req.path
      const attributes = {
        'http.method': req.method,
        'http.route': route,
        'http.status_code': res.statusCode,
      }

      // End span
      if (span) {
        span.setAttributes(
          this.applyRedaction({
            'http.status_code': res.statusCode,
            'http.route': route,
          }),
        )
        if (res.statusCode >= 400) {
          span.setStatus({ code: 2, message: `HTTP ${res.statusCode}` })
        }
        span.end()
      }

      // Record metrics
      if (this.requestCounter) {
        this.requestCounter.add(1, attributes)
      }
      if (this.requestDuration) {
        this.requestDuration.record(duration, attributes)
      }
    })
  }

  private shouldIgnore(path: string): boolean {
    if (!this.options.ignoreRoutes) return false
    return this.options.ignoreRoutes.some((pattern) => {
      if (pattern.endsWith('*')) {
        return path.startsWith(pattern.slice(0, -1))
      }
      return path === pattern
    })
  }

  /**
   * Run the configured redactor over an attribute bag. Exposed so
   * downstream code that adds attributes directly on a span
   * (`span.setAttributes(...)`) can share the same redaction contract.
   */
  applyRedaction<T extends Record<string, unknown>>(attrs: T): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(attrs)) {
      out[key] = this.redact(key, attrs[key])
    }
    return out
  }

  async shutdown(): Promise<void> {
    log.info('OTel adapter shutdown')
  }
}

/**
 * Build an attribute redactor from `sensitiveKeys` + optional
 * `redactAttribute` override. String keys match case-insensitively
 * against the attribute name; `RegExp` entries are matched verbatim.
 * A custom `redactAttribute` runs after the key-based mask so users
 * can inspect values too.
 */
function buildRedactor(
  sensitiveKeys: (string | RegExp)[] | undefined,
  custom: ((key: string, value: unknown) => unknown) | undefined,
): (key: string, value: unknown) => unknown {
  if (custom) return custom
  if (!sensitiveKeys || sensitiveKeys.length === 0) return (_k, v) => v

  const lowered = new Set<string>()
  const patterns: RegExp[] = []
  for (const entry of sensitiveKeys) {
    if (typeof entry === 'string') lowered.add(entry.toLowerCase())
    else patterns.push(entry)
  }

  return (key: string, value: unknown) => {
    const lower = key.toLowerCase()
    if (lowered.has(lower)) return '[REDACTED]'
    for (const p of patterns) {
      if (p.test(key)) return '[REDACTED]'
    }
    return value
  }
}
