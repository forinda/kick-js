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

/** Get the controller path set by @Controller('/path') */
export function getControllerPath(controllerClass: any): string {
  return getClassMeta<string>(METADATA.CONTROLLER_PATH, controllerClass, '/')
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
export function buildRoutes(controllerClass: any): Router {
  const router = Router()
  const container = Container.getInstance()
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

    if (classContributors.length > 0 || methodContributors.length > 0) {
      const sources: SourcedRegistration[] = [
        ...classContributors.map(
          (registration): SourcedRegistration => ({
            source: 'class',
            registration,
            label: `${controllerClass.name}.@class`,
          }),
        ),
        ...methodContributors.map(
          (registration): SourcedRegistration => ({
            source: 'method',
            registration,
            label: `${controllerClass.name}.${String(route.handlerName)}`,
          }),
        ),
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
