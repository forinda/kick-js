// The default Express runtime — the M1 reference implementation of HttpRuntime.
//
// Its route materializer rebuilds the exact `(req, res, next)` handler chain
// the old `buildRoutes()` produced, so swapping decorators → RouteTable →
// runtime is behavior-neutral under Express. `buildRoutes()` (the public,
// Router-returning API) now lives here as a thin shim over `buildRouteTable()`
// + this materializer.

import express, {
  Router,
  type Express,
  type Request,
  type Response,
  type NextFunction,
  type RequestHandler,
} from 'express'

import { buildRouteTable, type BuildRoutesOptions } from '../router-builder'
import { RequestContext } from '../context'
import { validate } from '../middleware/validate'
import { buildUploadMiddleware } from '../middleware/upload'
import type {
  ConnectMiddleware,
  HttpRuntime,
  RouteEntry,
  RouteTable,
  RuntimeAppOptions,
  UseConnectOptions,
} from '../runtime'

/**
 * Materialize a controller's {@link RouteEntry}[] onto a fresh `express.Router`.
 * Reproduces the legacy handler ordering precisely: validation → upload →
 * `(ctx, next)` middleware → contributor runner → terminal handler. Each step
 * constructs its own `RequestContext` over the same `req`/`res` — request-scoped
 * state lives in the AsyncLocalStorage store, not on the ctx instance, so the
 * per-step instances share state exactly as before.
 */
export function materializeRouter(entries: RouteEntry[]): Router {
  const router = Router()

  for (const entry of entries) {
    const method = entry.method.toLowerCase() as 'get' | 'post' | 'put' | 'delete' | 'patch'
    const handlers: RequestHandler[] = []

    // Validation middleware (shared with the standalone validate() export).
    if (entry.meta.validation) {
      handlers.push(validate(entry.meta.validation))
    }

    // @FileUpload — auto-attach upload middleware from metadata.
    if (entry.meta.upload) {
      handlers.push(buildUploadMiddleware(entry.meta.upload))
    }

    // Class + method middleware — wrapped as Express middleware with error catching.
    for (const mw of entry.middlewares) {
      handlers.push((req: Request, res: Response, next: NextFunction) => {
        const ctx = new RequestContext(req, res, next)
        Promise.resolve(mw(ctx, next)).catch(next)
      })
    }

    // Context Contributor pipeline (#107) — runs, then advances the chain.
    if (entry.contributorRunner) {
      const run = entry.contributorRunner
      handlers.push(async (req: Request, res: Response, next: NextFunction) => {
        const ctx = new RequestContext(req, res, next)
        try {
          await run(ctx)
          next()
        } catch (err) {
          next(err)
        }
      })
    }

    // Terminal handler.
    handlers.push(async (req: Request, res: Response, next: NextFunction) => {
      const ctx = new RequestContext(req, res, next)
      try {
        await entry.handler(ctx)
      } catch (err) {
        next(err)
      }
    })
    ;(router as any)[method](entry.path, ...handlers)
  }

  return router
}

/**
 * Build an Express Router from a controller class decorated with @Get, @Post,
 * etc. The public, back-compatible entry point: a thin shim over
 * {@link buildRouteTable} + {@link materializeRouter}. Returns an
 * `express.Router` exactly as before — modules pass it to `app.use(path, router)`.
 *
 * @see buildRouteTable for the engine-neutral route-table form.
 */
export function buildRoutes(controllerClass: any, options: BuildRoutesOptions = {}): Router {
  return materializeRouter(buildRouteTable(controllerClass, options))
}

/**
 * The default HTTP runtime. Express stays a peer dependency of `@forinda/kickjs`;
 * apps that pass no `runtime` get this and behave exactly as before.
 */
export function expressRuntime(): HttpRuntime<Express> {
  return {
    name: 'express',

    createApp(options: RuntimeAppOptions = {}): Express {
      const app = express()
      // Engine hardening + config the Application used to apply directly.
      app.disable('x-powered-by')
      app.set('trust proxy', options.trustProxy ?? false)
      return app
    },

    nodeHandler(app) {
      return (req, res, next) => {
        if (next) {
          ;(app as any)(req, res, next)
        } else {
          ;(app as any)(req, res)
        }
      }
    },

    mountRoutes(app, table: RouteTable) {
      for (const { mountPath, routes } of table) {
        app.use(mountPath, materializeRouter(routes))
      }
    },

    useConnect(app, mw: ConnectMiddleware, opts: UseConnectOptions = {}) {
      if (opts.path !== undefined) {
        ;(app as any).use(opts.path, mw)
      } else {
        ;(app as any).use(mw)
      }
    },

    serveStatic(app, prefix, dir) {
      app.use(prefix, express.static(dir))
    },

    setNotFound(app, mw: ConnectMiddleware) {
      ;(app as any).use(mw)
    },

    setErrorHandler(app, mw: ConnectMiddleware) {
      ;(app as any).use(mw)
    },

    capabilities: {
      render: true,
      uploads: true,
      connectMiddleware: true,
      nativeBodyParsing: false,
    },
  }
}
