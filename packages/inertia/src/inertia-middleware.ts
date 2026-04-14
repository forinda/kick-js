import { Inertia } from './inertia'
import type { InertiaConfig } from './types'

export function createInertiaMiddleware(config: InertiaConfig) {
  return async (req: any, res: any, next: any) => {
    const ctx = req.__kickRequestContext
    if (!ctx) return next()

    // Create per-request Inertia instance
    const inertia = new Inertia(ctx, config)
    ctx.set('inertia', inertia)

    // Load config-level shared data
    if (config.share) {
      const shared = await config.share(ctx)
      if (shared && typeof shared === 'object') {
        inertia.share(shared)
      }
    }

    const isInertiaRequest = req.headers['x-inertia'] === 'true'

    // Version mismatch check
    if (isInertiaRequest) {
      const clientVersion = req.headers['x-inertia-version'] as string | undefined
      const serverVersion = inertia.getVersion()

      if (clientVersion && clientVersion !== serverVersion) {
        res.status(409).setHeader('X-Inertia-Location', req.url).end()
        return
      }
    }

    // Intercept writeHead to rewrite 302 → 303 for mutation methods
    // before the response is flushed. The post-next() approach races
    // with Express's response pipeline — headers may already be sent.
    if (isInertiaRequest && ['PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      const originalWriteHead = res.writeHead.bind(res)
      res.writeHead = function (statusCode: number, ...args: any[]) {
        if (statusCode === 302) {
          statusCode = 303
        }
        return originalWriteHead(statusCode, ...args)
      }
    }

    next()
  }
}
