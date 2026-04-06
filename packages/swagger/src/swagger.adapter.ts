import { dirname } from 'node:path'
import { createRequire } from 'node:module'
import { Router } from 'express'
import express from 'express'
import { Logger, type AppAdapter, type AdapterContext } from '@forinda/kickjs'
import {
  buildOpenAPISpec,
  registerControllerForDocs,
  clearRegisteredRoutes,
  type SwaggerOptions,
} from './openapi-builder'
import { swaggerUIHtml, redocHtml } from './ui'

const log = Logger.for('SwaggerAdapter')

/**
 * Resolve the absolute path to swagger-ui-dist's static assets.
 * Uses createRequire to find it relative to this package (works with pnpm).
 */
function getSwaggerUiDistPath(): string {
  const require = createRequire(import.meta.url)
  return dirname(require.resolve('swagger-ui-dist/package.json'))
}

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
 * Assets are served locally from `swagger-ui-dist` (npm dependency) —
 * no CDN required, works fully offline.
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
 *   GET /docs         — Swagger UI (local assets, no CDN)
 *   GET /redoc        — ReDoc (CDN — no local package available)
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
    let UI_DIST_AVAILABLE = false

    const docsRouter = Router()

    // ── Serve swagger-ui-dist static assets locally ──────────────────
    // This makes Swagger UI work offline — no CDN needed.
    // Assets served at /_swagger-assets/ (CSS, JS, fonts, etc.)
    const swaggerAssetsPath = '/_swagger-assets'
    try {
      const swaggerDistDir = getSwaggerUiDistPath()
      docsRouter.use(swaggerAssetsPath, express.static(swaggerDistDir))
      UI_DIST_AVAILABLE = true
    } catch {
      log.warn('swagger-ui-dist not found — Swagger UI will load from CDN (requires internet).')
      //   We now fall back to the CDN version of the HTML, which references the CDN assets.
      docsRouter.use((req, res, next) => {
        res.setHeader(
          'Content-Security-Policy',
          [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' https://unpkg.com https://cdn.redoc.ly https://cdn.jsdelivr.net",
            "style-src 'self' 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com",
            "font-src 'self' https://fonts.gstatic.com",
            "img-src 'self' data: https://unpkg.com",
            "connect-src 'self'",
          ].join('; '),
        )
        next()
      })
    }

    // Spec endpoint (JSON)
    docsRouter.get(specPath, (_req, res) => {
      const spec = buildOpenAPISpec(this.options)
      res.json(spec)
    })

    // Swagger UI — uses local assets if available, CDN fallback
    docsRouter.get(docsPath, (_req, res) => {
      res
        .type('html')
        .send(
          swaggerUIHtml(
            specPath,
            this.options.info?.title,
            UI_DIST_AVAILABLE ? swaggerAssetsPath : undefined,
          ),
        )
    })

    // ReDoc — still CDN-based (no npm package for standalone bundle)
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
