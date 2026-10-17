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
import { applyHandlerResult } from '../reply'
import { validate } from '../middleware/validate'
import { publishMatchedRoute } from '../runtime'
import { buildUploadMiddleware } from '../middleware/upload'
import type { ConnectHandler } from '../connect'
import { EXPRESS_JSON_TYPES, rejectUnsupportedBody } from '../body-policy'
import { EXPRESS_CAPABILITIES } from './express-lazy'
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
 * `(ctx, next)` middleware → contributor runner → terminal handler, with
 * `beforeValidation` contributors ahead of validation. Each step
 * constructs its own `RequestContext` over the same `req`/`res` — request-scoped
 * state lives in the AsyncLocalStorage store, not on the ctx instance, so the
 * per-step instances share state exactly as before.
 */
export function materializeRouter(entries: RouteEntry[]): ConnectHandler {
  return expressRouter(entries)
}

function expressRouter(entries: RouteEntry[]): Router {
  const router = Router()

  for (const entry of entries) {
    const method = entry.method.toLowerCase() as 'get' | 'post' | 'put' | 'delete' | 'patch'
    const handlers: RequestHandler[] = []

    // Publish the matched route first, so every later step — validation,
    // upload, middleware, contributors, handler — reads the same `ctx.route`.
    handlers.push((req: Request, _res: Response, next: NextFunction) => {
      publishMatchedRoute(req, entry)
      next()
    })

    // Context Contributor pipeline (#107) — runs, then advances the chain
    // unless a contributor already answered.
    const contributorStep =
      (run: NonNullable<RouteEntry['contributorRunner']>): RequestHandler =>
      async (req: Request, res: Response, next: NextFunction) => {
        const ctx = new RequestContext(req, res, next)
        try {
          await run(ctx)
          if (!res.headersSent) next()
        } catch (err) {
          next(err)
        }
      }

    // `beforeValidation` contributors (#677) — an auth rejection answers 401
    // before a malformed body could answer 422.
    if (entry.earlyContributorRunner) {
      handlers.push(contributorStep(entry.earlyContributorRunner))
    }

    // Validation middleware (shared with the standalone validate() export).
    if (entry.meta.validation) {
      handlers.push(validate(entry.meta.validation, { validationError: entry.validationError }))
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

    if (entry.contributorRunner) {
      handlers.push(contributorStep(entry.contributorRunner))
    }

    // Terminal handler.
    handlers.push(async (req: Request, res: Response, next: NextFunction) => {
      const ctx = new RequestContext(req, res, next)
      try {
        const result = await entry.handler(ctx)
        // Return-value handlers (reply.ts): auto-send the returned payload
        // when the handler wrote nothing. `undefined` keeps prior behavior.
        if (!res.headersSent) await applyHandlerResult(ctx, result)
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
export function buildRoutes(
  controllerClass: any,
  options: BuildRoutesOptions = {},
): ConnectHandler {
  return expressRouter(buildRouteTable(controllerClass, options))
}

/**
 * The default HTTP runtime. Express stays a peer dependency of `@forinda/kickjs`;
 * apps that pass no `runtime` get this and behave exactly as before.
 */
export function expressRuntime(): HttpRuntime {
  const runtime: HttpRuntime<Express> = {
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
        app.use(mountPath, expressRouter(routes))
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

    bodyParsers({ limit }) {
      return [
        // EXPRESS_JSON_TYPES, not the default: `express.json()` matches the
        // exact string `application/json`, so `application/merge-patch+json`
        // arrived unparsed while Fastify answered 415 and h3 parsed it (#590).
        express.json({ limit, type: [...EXPRESS_JSON_TYPES] }),
        // Forms and text were parsed by h3 and rejected by Fastify; on Express
        // they reached the handler as `undefined`, because the engine parsed
        // only what its middleware list happened to cover.
        express.urlencoded({ extended: true, limit }),
        express.text({ limit, type: 'text/*' }),
        // After the parsers: Express leaves an unmatched type as `undefined`,
        // which is indistinguishable from "no body sent". This restores the
        // difference so an unsupported type is answered rather than ignored.
        rejectUnsupportedBody(),
      ]
    },

    capabilities: EXPRESS_CAPABILITIES,
  }
  return runtime as HttpRuntime
}
