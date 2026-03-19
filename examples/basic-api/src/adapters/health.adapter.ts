import type { Express } from 'express'
import type { AppAdapter, AdapterMiddleware, Container } from '@kickjs/core'

/**
 * Example adapter that registers health check endpoints and contributes
 * middleware via the declarative `middleware()` method.
 *
 * Shows both approaches:
 *   - `beforeMount()` for raw Express control (routes, settings)
 *   - `middleware()` for declarative middleware contribution with phase control
 */
export class HealthAdapter implements AppAdapter {
  name = 'HealthAdapter'

  /**
   * Mount health routes directly on the Express app.
   * These bypass the global middleware stack (no auth, no rate limits).
   */
  beforeMount(app: Express, _container: Container): void {
    app.get('/health', (_req, res) => {
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      })
    })

    app.get('/health/ready', (_req, res) => {
      // In a real app, check DB, Redis, etc.
      res.json({
        status: 'ok',
        checks: {
          database: { status: 'ok' },
          redis: { status: 'ok' },
        },
      })
    })
  }

  /**
   * Contribute middleware declaratively.
   * This runs at the specified phase in the Application pipeline.
   */
  middleware(): AdapterMiddleware[] {
    return [
      {
        phase: 'beforeGlobal',
        handler: (_req: any, res: any, next: any) => {
          res.setHeader('X-Powered-By', 'KickJS')
          next()
        },
      },
    ]
  }
}
