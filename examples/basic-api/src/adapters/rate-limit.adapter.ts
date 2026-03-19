import type { Express } from 'express'
import type { AppAdapter, AdapterMiddleware, Container } from '@forinda/kickjs-core'

export interface RateLimitAdapterOptions {
  // Add your adapter configuration here
}

/**
 * RateLimit adapter.
 *
 * Hooks into the Application lifecycle to add middleware, routes,
 * or external service connections.
 *
 * Usage:
 *   bootstrap({
 *     adapters: [new RateLimitAdapter({ ... })],
 *   })
 */
export class RateLimitAdapter implements AppAdapter {
  name = 'RateLimitAdapter'

  constructor(private options: RateLimitAdapterOptions = {}) {}

  /**
   * Return middleware entries that the Application will mount.
   * Use `phase` to control where in the pipeline they run:
   *   'beforeGlobal' | 'afterGlobal' | 'beforeRoutes' | 'afterRoutes'
   */
  middleware(): AdapterMiddleware[] {
    return [
      // Example: add a custom header to all responses
      // {
      //   phase: 'beforeGlobal',
      //   handler: (_req: any, res: any, next: any) => {
      //     res.setHeader('X-RateLimit', 'true')
      //     next()
      //   },
      // },
      // Example: scope middleware to a specific path
      // {
      //   phase: 'beforeRoutes',
      //   path: '/api/v1/admin',
      //   handler: myAdminMiddleware(),
      // },
    ]
  }

  /**
   * Called before global middleware.
   * Use this to mount routes that bypass the middleware stack
   * (health checks, docs UI, static assets).
   */
  beforeMount(app: Express, container: Container): void {
    // Example: mount a status route
    // app.get('/rate-limit/status', (_req, res) => {
    //   res.json({ status: 'ok' })
    // })
  }

  /**
   * Called after modules and routes are registered, before the server starts.
   * Use this for late-stage DI registrations or config validation.
   */
  beforeStart(app: Express, container: Container): void {
    // Example: register a service in the DI container
    // container.registerInstance(MY_TOKEN, new MyService(this.options))
  }

  /**
   * Called after the HTTP server is listening.
   * Use this to attach to the raw http.Server (Socket.IO, gRPC, etc).
   */
  afterStart(server: any, container: Container): void {
    // Example: attach Socket.IO
    // const io = new Server(server)
    // container.registerInstance(SOCKET_IO, io)
  }

  /**
   * Called on graceful shutdown. Clean up connections.
   */
  async shutdown(): Promise<void> {
    // Example: close a connection pool
    // await this.pool.end()
  }
}
