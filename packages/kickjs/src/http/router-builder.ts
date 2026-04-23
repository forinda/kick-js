import { Router, type Request, type Response, type NextFunction } from 'express'
import {
  buildPipeline,
  Container,
  METADATA,
  runContributors,
  type ContributorRegistration,
  type FileUploadConfig,
  type MiddlewareHandler,
  type RouteDefinition,
  type SourcedRegistration,
} from '../core'
import { getClassMeta, getMethodMeta, getMethodMetaOrUndefined } from '../core/metadata'
import { RequestContext } from './context'
import { validate } from './middleware/validate'
import { buildUploadMiddleware } from './middleware/upload'

/**
 * Per-module SourcedRegistration[] threaded through the route-mount loop by
 * Application.setup(). Carries module + adapter + global contributors so
 * buildRoutes() can merge them with class + method ones into a single pipeline.
 *
 * Module setup is sequential, so this slot is race-free. Cleared in a finally
 * block after each module mounts. Outside of Application setup the slot is
 * empty — direct buildRoutes() callers (mostly tests) see only class + method
 * contributors unless they pass `externalSources` explicitly.
 *
 * Same idiom as `Container._requestStoreProvider` and `Logger._contextProvider`:
 * an internal escape hatch for cross-module wiring without inversion-of-control
 * gymnastics.
 *
 * @internal
 */
let _externalContributorSources: readonly SourcedRegistration[] = []

/** @internal — set by Application.setup() before each `mod.routes()` call. */
export function _setExternalContributorSources(sources: readonly SourcedRegistration[]): void {
  _externalContributorSources = sources
}

export interface BuildRoutesOptions {
  /**
   * Extra contributors to merge into the per-route pipeline at their declared
   * precedence levels. Pass explicitly when calling buildRoutes outside the
   * Application route-mount loop (typically in tests). When omitted, falls
   * back to the slot set by Application.setup().
   */
  externalSources?: readonly SourcedRegistration[]
}

/**
 * Build an Express Router from a controller class decorated with @Get, @Post, etc.
 * Resolves the controller from the DI container, wraps handlers in RequestContext,
 * and applies class-level and method-level middleware.
 *
 * Routes are registered using only the method-level decorator paths (e.g. @Get('/me') → '/me').
 * The @Controller path is NOT baked into the router — it serves as metadata only
 * (used by Swagger and other adapters for introspection).
 * The module's routes().path is the single source of truth for the mount prefix,
 * which avoids path doubling when both the module and controller specify the same path.
 */
export function buildRoutes(controllerClass: any, options: BuildRoutesOptions = {}): Router {
  const router = Router()
  const container = Container.getInstance()
  const externalSources = options.externalSources ?? _externalContributorSources
  const routes: RouteDefinition[] = getClassMeta<RouteDefinition[]>(
    METADATA.ROUTES,
    controllerClass,
    [],
  )

  // Class-level middleware
  const classMiddlewares: MiddlewareHandler[] = getClassMeta<MiddlewareHandler[]>(
    METADATA.CLASS_MIDDLEWARES,
    controllerClass,
    [],
  )

  // Class-level Context Contributors (#107) — applied to every method on the
  // controller. Method-level contributors are added per-route below.
  const classContributors: ContributorRegistration[] = getClassMeta<ContributorRegistration[]>(
    METADATA.CLASS_CONTRIBUTORS,
    controllerClass,
    [],
  )

  for (const route of routes) {
    const method = route.method.toLowerCase() as 'get' | 'post' | 'put' | 'delete' | 'patch'
    const fullPath = route.path || '/'

    // Method-level middleware
    const methodMiddlewares: MiddlewareHandler[] = getMethodMeta<MiddlewareHandler[]>(
      METADATA.METHOD_MIDDLEWARES,
      controllerClass,
      route.handlerName,
      [],
    )

    // Build handler chain
    const handlers: any[] = []

    // Validation middleware (shared with standalone validate() export)
    if (route.validation) {
      handlers.push(validate(route.validation))
    }

    // @FileUpload decorator — auto-attach upload middleware from metadata
    const fileUploadConfig = getMethodMetaOrUndefined<FileUploadConfig>(
      METADATA.FILE_UPLOAD,
      controllerClass,
      route.handlerName,
    )
    if (fileUploadConfig) {
      handlers.push(buildUploadMiddleware(fileUploadConfig))
    }

    // Class + method middleware (wrapped as Express middleware with error catching)
    for (const mw of [...classMiddlewares, ...methodMiddlewares]) {
      handlers.push((req: Request, res: Response, next: NextFunction) => {
        const ctx = new RequestContext(req, res, next)
        Promise.resolve(mw(ctx, next)).catch(next)
      })
    }

    // Context Contributor pipeline (#107) — class + method contributors,
    // built once at mount time so cycle/missing-dep failures abort boot.
    const methodContributors: ContributorRegistration[] = getMethodMeta<ContributorRegistration[]>(
      METADATA.METHOD_CONTRIBUTORS,
      controllerClass,
      route.handlerName,
      [],
    )

    if (
      classContributors.length > 0 ||
      methodContributors.length > 0 ||
      externalSources.length > 0
    ) {
      // Labels are surfaced in DuplicateContributorError messages — include
      // the registration's key + the original index so a same-key collision
      // at one precedence level points at the conflicting decorator slot,
      // not just the host method/class.
      const sources: SourcedRegistration[] = [
        ...methodContributors.map(
          (registration, i): SourcedRegistration => ({
            source: 'method',
            registration,
            label: `${controllerClass.name}.${String(route.handlerName)}#${i}(${registration.key})`,
          }),
        ),
        ...classContributors.map(
          (registration, i): SourcedRegistration => ({
            source: 'class',
            registration,
            label: `${controllerClass.name}.@class#${i}(${registration.key})`,
          }),
        ),
        ...externalSources,
      ]
      const pipeline = buildPipeline(sources, {
        route: `${route.method.toUpperCase()} ${fullPath}`,
      })

      handlers.push(async (req: Request, res: Response, next: NextFunction) => {
        const ctx = new RequestContext(req, res, next)
        try {
          await runContributors({ pipeline, ctx, container })
          next()
        } catch (err) {
          next(err)
        }
      })
    }

    // Main handler — resolve controller per-request to respect DI scoping
    handlers.push(async (req: Request, res: Response, next: NextFunction) => {
      const ctx = new RequestContext(req, res, next)
      try {
        const controller = container.resolve(controllerClass)
        await controller[route.handlerName](ctx)
      } catch (err: any) {
        next(err)
      }
    })
    ;(router as any)[method](fullPath, ...handlers)
  }

  return router
}
