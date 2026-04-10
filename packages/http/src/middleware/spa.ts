import { existsSync, readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { Logger, type AppAdapter, type AdapterContext } from '@forinda/kickjs-core'

const log = Logger.for('SpaAdapter')

export interface SpaAdapterOptions {
  /**
   * Directory containing the built SPA files (index.html, assets, etc.)
   * Default: 'dist/client'
   *
   * @example
   * ```ts
   * // Vue: 'dist'
   * // React (Vite): 'dist'
   * // React (CRA): 'build'
   * // Svelte: 'build'
   * // Angular: 'dist/my-app/browser'
   * ```
   */
  clientDir?: string

  /**
   * URL prefix for API routes. SPA fallback only applies to
   * non-API routes (routes NOT starting with this prefix).
   * Default: '/api'
   *
   * Set to an array for multiple prefixes:
   * ```ts
   * apiPrefix: ['/api', '/graphql', '/_debug']
   * ```
   */
  apiPrefix?: string | string[]

  /**
   * Additional paths to exclude from SPA fallback.
   * These paths will NOT serve index.html.
   *
   * @example
   * ```ts
   * exclude: ['/health', '/metrics', '/ws']
   * ```
   */
  exclude?: string[]

  /**
   * Cache-Control header for static assets (default: 'public, max-age=31536000, immutable')
   * Set to false to disable caching headers.
   */
  cacheControl?: string | false

  /**
   * Cache-Control for index.html (default: 'no-cache')
   * index.html should not be cached to ensure clients get fresh builds.
   */
  indexCacheControl?: string
}

/**
 * SPA adapter — serve a Vue, React, Svelte, or Angular build alongside
 * your KickJS API. API routes are handled by controllers; everything else
 * falls back to index.html for client-side routing.
 *
 * @example
 * ```ts
 * import { SpaAdapter } from '@forinda/kickjs-http/spa'
 *
 * bootstrap({
 *   modules,
 *   adapters: [
 *     new SpaAdapter({
 *       clientDir: 'dist/client',  // or 'build', 'dist', etc.
 *       apiPrefix: '/api',
 *     }),
 *   ],
 * })
 * ```
 *
 * File structure:
 * ```
 * dist/
 *   client/           ← SPA build output
 *     index.html
 *     assets/
 *       app.js
 *       style.css
 *   server/            ← KickJS server
 * ```
 */
export class SpaAdapter implements AppAdapter {
  name = 'SpaAdapter'
  private clientDir: string
  private apiPrefixes: string[]
  private excludePaths: string[]
  private cacheControl: string | false
  private indexCacheControl: string
  private indexHtml: string | null = null

  constructor(private options: SpaAdapterOptions = {}) {
    this.clientDir = resolve(options.clientDir ?? 'dist/client')
    this.excludePaths = options.exclude ?? []
    this.cacheControl = options.cacheControl ?? 'public, max-age=31536000, immutable'
    this.indexCacheControl = options.indexCacheControl ?? 'no-cache'

    const prefix = options.apiPrefix ?? '/api'
    this.apiPrefixes = Array.isArray(prefix) ? prefix : [prefix]
  }

  beforeMount({ app }: AdapterContext): void {
    if (!existsSync(this.clientDir)) {
      log.warn(`SPA client directory not found: ${this.clientDir}`)
      log.warn('Build your frontend first, or set clientDir to the correct path.')
      return
    }

    // Read index.html into memory
    const indexPath = join(this.clientDir, 'index.html')
    if (existsSync(indexPath)) {
      this.indexHtml = readFileSync(indexPath, 'utf-8')
    } else {
      log.warn(`index.html not found in ${this.clientDir}`)
      return
    }

    // Serve static files with cache headers
    try {
      // Dynamic import to avoid hard dependency on express.static
      const express = require('express')
      const staticOpts: any = {}

      if (this.cacheControl) {
        staticOpts.setHeaders = (res: any, filePath: string) => {
          if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', this.indexCacheControl)
          } else {
            res.setHeader('Cache-Control', this.cacheControl as string)
          }
        }
      }

      app.use(express.static(this.clientDir, staticOpts))
    } catch {
      log.error('express.static not available — SPA static file serving disabled')
      return
    }

    log.debug(`Serving SPA from ${this.clientDir}`)
  }

  beforeStart({ app }: AdapterContext): void {
    if (!this.indexHtml) return

    // SPA fallback: serve index.html for all non-API, non-file routes
    app.use((req: any, res: any, next: any) => {
      // Skip API routes
      for (const prefix of this.apiPrefixes) {
        if (req.path.startsWith(prefix)) return next()
      }

      // Skip excluded paths
      for (const path of this.excludePaths) {
        if (req.path.startsWith(path)) return next()
      }

      // Skip requests for files (have an extension)
      if (req.path.includes('.')) return next()

      // Skip non-GET requests
      if (req.method !== 'GET') return next()

      // Serve index.html
      res.setHeader('Content-Type', 'text/html')
      res.setHeader('Cache-Control', this.indexCacheControl)
      res.send(this.indexHtml)
    })
  }
}
