import { dirname } from 'node:path'
import { createRequire } from 'node:module'
import express, { Router } from 'express'
import { Logger, defineAdapter } from '@forinda/kickjs'
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
  /**
   * When true, the adapter is a no-op while `NODE_ENV === 'production'` —
   * docs, spec, and assets are not mounted. Useful for keeping API docs
   * out of production builds without conditionally constructing the adapter.
   */
  disableInProd?: boolean
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
 *     SwaggerAdapter({
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
export const SwaggerAdapter = defineAdapter<SwaggerAdapterOptions>({
  name: 'SwaggerAdapter',
  defaults: {
    docsPath: '/docs',
    redocPath: '/redoc',
    specPath: '/openapi.json',
  },
  build: (config) => {
    // Resolved once at build time — config.disableInProd is set at
    // construction; NODE_ENV doesn't change at runtime. Checking on
    // every onRouteMount call (which fires per-controller) is noise.
    const disabled = Boolean(config.disableInProd) && process.env.NODE_ENV === 'production'
    const isDisabled = (): boolean => disabled

    // Snapshot the user-supplied servers list once per adapter instance
    // so subsequent afterStart runs (HMR reload, dev-mode restart loops,
    // multi-instance pre-fork in tests) re-derive the auto-detected
    // entries from a clean baseline instead of stacking duplicates onto
    // the previous run's accretion.
    const userSuppliedServers: ReadonlyArray<{ url: string; description?: string }> = config.servers
      ? [...config.servers]
      : []

    return {
      onRouteMount(controllerClass, mountPath) {
        if (isDisabled()) return
        // Pass `config` as the scope key so each SwaggerAdapter instance
        // owns its own route bag — two bootstraps in one process can't
        // cross-contaminate each other's specs.
        registerControllerForDocs(controllerClass, mountPath, config)
      },

      afterStart({ server }) {
        if (isDisabled()) return
        const addr = server?.address?.()
        if (!addr || typeof addr !== 'object') return

        const host =
          addr.address === '::' || addr.address === '0.0.0.0' ? 'localhost' : addr.address

        const autoDetected: { url: string; description?: string }[] = []
        // HTTP server URL is always auto-added — adopters who passed an
        // explicit HTTP URL keep their entry first because we restart
        // from the user snapshot above.
        autoDetected.push({ url: `http://${host}:${addr.port}`, description: 'HTTP server' })

        // Auto-add WebSocket server URLs from WsAdapter (one per namespace)
        const wsAdapter = config.adapters?.find(
          (a) => a.name === 'WsAdapter' && typeof a.getStats === 'function',
        )
        if (wsAdapter) {
          const stats = wsAdapter.getStats()
          for (const namespace of Object.keys(stats.namespaces || {})) {
            autoDetected.push({
              url: `ws://${host}:${addr.port}${namespace}`,
              description: `WebSocket: ${namespace}`,
            })
          }
        }

        // Always rebuild from the snapshot — replaces any leftover
        // auto-detected entries from a previous afterStart run.
        config.servers = [...userSuppliedServers, ...autoDetected]
      },

      beforeMount({ app }) {
        if (isDisabled()) {
          log.info('Swagger disabled in production (disableInProd=true)')
          return
        }
        // Clear previous registrations for THIS adapter (supports HMR
        // rebuild). Sibling adapters' route bags stay untouched.
        clearRegisteredRoutes(config)
        const docsPath = config.docsPath!
        const redocPath = config.redocPath!
        const specPath = config.specPath!
        let uiDistAvailable = false

        const docsRouter = Router()

        // ── Serve swagger-ui-dist static assets locally ──────────────────
        // This makes Swagger UI work offline — no CDN needed.
        // Assets served at /_swagger-assets/ (CSS, JS, fonts, etc.)
        const swaggerAssetsPath = '/_swagger-assets'
        try {
          const swaggerDistDir = getSwaggerUiDistPath()
          docsRouter.use(swaggerAssetsPath, express.static(swaggerDistDir))
          uiDistAvailable = true
        } catch {
          log.warn('swagger-ui-dist not found — Swagger UI will load from CDN (requires internet).')
        }

        // Relax CSP for Swagger UI in both local and CDN modes (inline script is used in both)
        docsRouter.use((_req, res, next) => {
          // Build connect-src dynamically so "Try it out" can call any configured server URL.
          // Includes dev-friendly localhost/127.0.0.1 origins so docs served from one host
          // can call an API spec'd at the other (a common cross-origin gotcha).
          const serverOrigins = new Set<string>()
          for (const s of config.servers ?? []) {
            try {
              serverOrigins.add(new URL(s.url).origin)
            } catch {
              // ignore relative or malformed URLs
            }
          }
          const connectSrc = [
            "'self'",
            'http://localhost:*',
            'http://127.0.0.1:*',
            'https://localhost:*',
            'https://127.0.0.1:*',
            'ws://localhost:*',
            'ws://127.0.0.1:*',
            ...serverOrigins,
          ].join(' ')

          res.setHeader(
            'Content-Security-Policy',
            [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' https://unpkg.com https://cdn.redoc.ly https://cdn.jsdelivr.net",
              "style-src 'self' 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              "img-src 'self' data: https://unpkg.com",
              `connect-src ${connectSrc}`,
            ].join('; '),
          )
          next()
        })

        // Spec endpoint (JSON)
        docsRouter.get(specPath, (_req, res) => {
          const spec = buildOpenAPISpec(config)
          res.json(spec)
        })

        // Swagger UI — uses local assets if available, CDN fallback
        docsRouter.get(docsPath, (_req, res) => {
          res
            .type('html')
            .send(
              swaggerUIHtml(
                specPath,
                config.info?.title,
                uiDistAvailable ? swaggerAssetsPath : undefined,
              ),
            )
        })

        // ReDoc — still CDN-based (no npm package for standalone bundle)
        docsRouter.get(redocPath, (_req, res) => {
          res.type('html').send(redocHtml(specPath, config.info?.title))
        })

        app.use(docsRouter)

        log.info(`Swagger UI:  ${docsPath}`)
        log.info(`ReDoc:       ${redocPath}`)
        log.info(`OpenAPI spec: ${specPath}`)
      },
    }
  },
})

// Re-export for use by Application when mounting module routes
export { registerControllerForDocs, clearRegisteredRoutes }
