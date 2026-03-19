import type { Express } from 'express'
import type { AppAdapter, Container } from '@kickjs/core'

interface CorsAdapterOptions {
  origin?: string | string[] | boolean
  methods?: string[]
  allowedHeaders?: string[]
  credentials?: boolean
  maxAge?: number
}

/**
 * Example adapter that adds CORS middleware to the Express instance.
 *
 * Shows how adapters can programmatically control the Express app —
 * add middleware, mount routes, configure settings, anything Express supports.
 */
export class CorsAdapter implements AppAdapter {
  name = 'CorsAdapter'

  constructor(private options: CorsAdapterOptions = {}) {}

  /**
   * `beforeMount` receives the raw Express app.
   * You have full control — add any middleware, routes, or settings.
   */
  beforeMount(app: Express, _container: Container): void {
    const {
      origin = '*',
      methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders = ['Content-Type', 'Authorization'],
      credentials = false,
      maxAge = 86400,
    } = this.options

    app.use((req, res, next) => {
      const originValue = Array.isArray(origin) ? origin.join(',') : String(origin)
      res.setHeader('Access-Control-Allow-Origin', originValue)
      res.setHeader('Access-Control-Allow-Methods', methods.join(','))
      res.setHeader('Access-Control-Allow-Headers', allowedHeaders.join(','))
      res.setHeader('Access-Control-Max-Age', String(maxAge))

      if (credentials) {
        res.setHeader('Access-Control-Allow-Credentials', 'true')
      }

      if (req.method === 'OPTIONS') {
        res.status(204).end()
        return
      }

      next()
    })
  }
}
