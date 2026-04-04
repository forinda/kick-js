import { Router } from 'express'
import { Logger, type AppAdapter, type AdapterContext } from '@forinda/kickjs'
import {
  buildOpenAPISpec,
  registerControllerForDocs,
  clearRegisteredRoutes,
  type SwaggerOptions,
} from './openapi-builder'
import { swaggerUIHtml, redocHtml } from './ui'

const log = Logger.for('SwaggerAdapter')

export interface SwaggerAdapterOptions extends SwaggerOptions {
  /** Path to serve Swagger UI (default: '/docs') */
  docsPath?: string
  /** Path to serve ReDoc (default: '/redoc') */
  redocPath?: string
  /** Path to serve the raw JSON spec (default: '/openapi.json') */
  specPath?: string
  /** Other adapters to discover (e.g., WsAdapter for WebSocket server URLs) */
  adapters?: any[]
}

/**
 * Swagger adapter — auto-generates OpenAPI spec from decorators and serves docs.
 *
 * @example
 * ```ts
 * bootstrap({
 *   modules,
 *   adapters: [
 *     new SwaggerAdapter({
 *       info: { title: 'My API', version: '1.0.0' },
 *     }),
 *   ],
 * })
 * ```
 *
 * Endpoints:
 *   GET /docs         — Swagger UI
 *   GET /redoc        — ReDoc
 *   GET /openapi.json — Raw OpenAPI 3.0.3 spec
 */
export class SwaggerAdapter implements AppAdapter {
  name = 'SwaggerAdapter'

  constructor(private options: SwaggerAdapterOptions = {}) {}

  /** Auto-detect server URLs from the running HTTP server and peer adapters */
  afterStart({ server }: AdapterContext): void {
    const addr = server?.address?.()
    if (!addr || typeof addr !== 'object') return

    const host = addr.address === '::' || addr.address === '0.0.0.0' ? 'localhost' : addr.address

    // Auto-add HTTP server URL if none configured
    if (!this.options.servers || this.options.servers.length === 0) {
      this.options.servers = [{ url: `http://${host}:${addr.port}`, description: 'HTTP server' }]
    }

    // Auto-add WebSocket server URLs from WsAdapter
    const wsAdapter = this.options.adapters?.find(
      (a) => a.name === 'WsAdapter' && typeof a.getStats === 'function',
    )
    if (wsAdapter) {
      const stats = wsAdapter.getStats()
      for (const namespace of Object.keys(stats.namespaces || {})) {
        this.options.servers!.push({
          url: `ws://${host}:${addr.port}${namespace}`,
          description: `WebSocket: ${namespace}`,
        })
      }
    }
  }

  /** Collect controller metadata as routes are mounted */
  onRouteMount(controllerClass: any, mountPath: string): void {
    registerControllerForDocs(controllerClass, mountPath)
  }

  beforeMount({ app }: AdapterContext): void {
    // Clear previous registrations (supports HMR rebuild)
    clearRegisteredRoutes()
    const docsPath = this.options.docsPath ?? '/docs'
    const redocPath = this.options.redocPath ?? '/redoc'
    const specPath = this.options.specPath ?? '/openapi.json'

    // Use a sub-router with relaxed CSP so CDN scripts load
    const docsRouter = Router()

    docsRouter.use((_req, res, next) => {
      res.setHeader(
        'Content-Security-Policy',
        [
          "default-src 'self'",
          // Allow Vite's HMR client (/@vite/*), CDN scripts, and inline scripts
          "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://unpkg.com https://cdn.redoc.ly https://cdn.jsdelivr.net",
          "style-src 'self' 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com",
          "font-src 'self' https://fonts.gstatic.com",
          "img-src 'self' data: https://unpkg.com",
          // Allow connecting to self (API) + Vite HMR WebSocket
          "connect-src 'self' ws://localhost:* wss://localhost:*",
        ].join('; '),
      )
      next()
    })

    // Spec endpoint (JSON)
    docsRouter.get(specPath, (_req, res) => {
      const spec = buildOpenAPISpec(this.options)
      res.json(spec)
    })

    // Swagger UI
    docsRouter.get(docsPath, (_req, res) => {
      res.type('html').send(swaggerUIHtml(specPath, this.options.info?.title))
    })

    // ReDoc
    docsRouter.get(redocPath, (_req, res) => {
      res.type('html').send(redocHtml(specPath, this.options.info?.title))
    })

    app.use(docsRouter)

    log.info(`Swagger UI:  ${docsPath}`)
    log.info(`ReDoc:       ${redocPath}`)
    log.info(`OpenAPI spec: ${specPath}`)
  }
}

// Re-export for use by Application when mounting module routes
export { registerControllerForDocs, clearRegisteredRoutes }
