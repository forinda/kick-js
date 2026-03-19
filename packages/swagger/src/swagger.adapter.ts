import { Router } from 'express'
import type { Express } from 'express'
import { Logger, type AppAdapter, type Container } from '@forinda/kickjs-core'
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

  /** Collect controller metadata as routes are mounted */
  onRouteMount(controllerClass: any, mountPath: string): void {
    registerControllerForDocs(controllerClass, mountPath)
  }

  beforeMount(app: Express, _container: Container): void {
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
          "script-src 'self' 'unsafe-inline' https://unpkg.com https://cdn.redoc.ly https://cdn.jsdelivr.net",
          "style-src 'self' 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com",
          "font-src 'self' https://fonts.gstatic.com",
          "img-src 'self' data: https://unpkg.com",
          "connect-src 'self'",
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
