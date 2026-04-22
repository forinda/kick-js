import { Logger, defineAdapter, type AdapterMiddleware } from '@forinda/kickjs'
import type { Request, Response, NextFunction } from 'express'
import type { OtelAdapterOptions } from './types'

const log = Logger.for('OtelAdapter')

/**
 * Public extension methods exposed by an OtelAdapter instance beyond
 * the standard {@link AppAdapter} contract. Surfaced via `TExtra` on
 * `defineAdapter` so peer adapters / tests / downstream code that
 * adds attributes directly on a span can share the redaction contract.
 */
export interface OtelAdapterExtensions {
  /**
   * Run the configured redactor over an attribute bag. Useful for code
   * that adds attributes directly on a span (`span.setAttributes(...)`)
   * outside the request middleware path — applies the same key matching
   * (case-insensitive strings, regex patterns) declared on the adapter.
   */
  applyRedaction<T extends Record<string, unknown>>(attrs: T): Record<string, unknown>
}

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
 *     OtelAdapter({
 *       serviceName: 'my-api',
 *       serviceVersion: '1.0.0',
 *       ignoreRoutes: ['/health', '/_debug/*'],
 *     }),
 *   ],
 * })
 * ```
 */
export const OtelAdapter = defineAdapter<OtelAdapterOptions, OtelAdapterExtensions>({
  name: 'OtelAdapter',
  defaults: {
    serviceName: 'kickjs-app',
    serviceVersion: '0.0.0',
    tracing: true,
    metrics: true,
  },
  build: (options) => {
    const redact = buildRedactor(options.sensitiveKeys, options.redactAttribute)

    let tracer: any = null
    let meter: any = null
    let requestCounter: any = null
    let requestDuration: any = null

    const applyRedaction = <T extends Record<string, unknown>>(
      attrs: T,
    ): Record<string, unknown> => {
      const out: Record<string, unknown> = {}
      for (const key of Object.keys(attrs)) {
        out[key] = redact(key, attrs[key])
      }
      return out
    }

    const shouldIgnore = (path: string): boolean => {
      if (!options.ignoreRoutes) return false
      return options.ignoreRoutes.some((pattern) => {
        if (pattern.endsWith('*')) {
          return path.startsWith(pattern.slice(0, -1))
        }
        return path === pattern
      })
    }

    const onFinish = (req: Request, res: Response, startTime: number, span: any): void => {
      res.on('finish', () => {
        const duration = performance.now() - startTime
        const route = (req as any).route?.path ?? req.path
        const attributes = {
          'http.method': req.method,
          'http.route': route,
          'http.status_code': res.statusCode,
        }

        if (span) {
          span.setAttributes(
            applyRedaction({
              'http.status_code': res.statusCode,
              'http.route': route,
            }),
          )
          if (res.statusCode >= 400) {
            span.setStatus({ code: 2, message: `HTTP ${res.statusCode}` })
          }
          span.end()
        }

        if (requestCounter) {
          requestCounter.add(1, attributes)
        }
        if (requestDuration) {
          requestDuration.record(duration, attributes)
        }
      })
    }

    return {
      applyRedaction,

      beforeStart() {
        try {
          // Dynamically import OTel API — it's a peer dependency
          const otelApi = require('@opentelemetry/api')

          if (options.tracing) {
            tracer = otelApi.trace.getTracer(options.serviceName!, options.serviceVersion!)
            log.info(`Tracing enabled for ${options.serviceName}`)
          }

          if (options.metrics) {
            meter = otelApi.metrics.getMeter(options.serviceName!, options.serviceVersion!)

            requestCounter = meter.createCounter('http.server.request.count', {
              description: 'Total number of HTTP requests',
            })

            requestDuration = meter.createHistogram('http.server.request.duration', {
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
      },

      middleware(): AdapterMiddleware[] {
        return [
          {
            handler: (req: Request, res: Response, next: NextFunction) => {
              if (shouldIgnore(req.path)) {
                return next()
              }

              const startTime = performance.now()

              let span: any = null
              if (tracer) {
                const otelApi = require('@opentelemetry/api')
                span = tracer.startSpan(`${req.method} ${req.route?.path ?? req.path}`, {
                  attributes: applyRedaction({
                    'http.method': req.method,
                    'http.url': req.originalUrl,
                    'http.target': req.path,
                    'http.user_agent': req.get('user-agent') ?? '',
                    'net.host.name': req.hostname,
                    ...(options.customAttributes?.(req) ?? {}),
                  }),
                })

                const ctx = otelApi.trace.setSpan(otelApi.context.active(), span)
                otelApi.context.with(ctx, () => {
                  onFinish(req, res, startTime, span)
                  next()
                })
                return
              }

              onFinish(req, res, startTime, null)
              next()
            },
            phase: 'beforeGlobal',
          },
        ]
      },

      async shutdown() {
        log.info('OTel adapter shutdown')
      },
    }
  },
})

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
