import type { Express } from 'express'
import type { AppAdapter, AdapterMiddleware, Container } from '@kickjs/core'

/**
 * Health check adapter -- registers /health and /health/ready endpoints.
 *
 * These bypass the global middleware stack (no auth, no CSRF, no rate limits)
 * because they are mounted in beforeMount().
 *
 * Also contributes a "beforeGlobal" middleware that sets X-Powered-By.
 */
export class HealthAdapter implements AppAdapter {
  name = 'HealthAdapter'

  beforeMount(app: Express, _container: Container): void {
    app.get('/health', (_req, res) => {
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      })
    })

    app.get('/health/ready', (_req, res) => {
      // In a real app, check DB connections, Redis, message queues, etc.
      res.json({
        status: 'ok',
        checks: {
          database: { status: 'ok' },
          cache: { status: 'ok' },
          storage: { status: 'ok' },
        },
      })
    })
  }

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
