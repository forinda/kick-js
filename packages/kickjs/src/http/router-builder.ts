import 'reflect-metadata'
import { Router, type Request, type Response, type NextFunction } from 'express'
import {
  Container,
  METADATA,
  type RouteDefinition,
  type MiddlewareHandler,
  type FileUploadConfig,
} from '../core'
import { RequestContext } from './context'
import { validate } from './middleware/validate'
import { buildUploadMiddleware } from './middleware/upload'

/** Get the controller path set by @Controller('/path') */
export function getControllerPath(controllerClass: any): string {
  return Reflect.getMetadata(METADATA.CONTROLLER_PATH, controllerClass) || '/'
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
  const routes: RouteDefinition[] = Reflect.getMetadata(METADATA.ROUTES, controllerClass) || []

  // Class-level middleware
  const classMiddlewares: MiddlewareHandler[] =
    Reflect.getMetadata(METADATA.CLASS_MIDDLEWARES, controllerClass) || []

  for (const route of routes) {
    const method = route.method.toLowerCase() as 'get' | 'post' | 'put' | 'delete' | 'patch'
    const fullPath = route.path || '/'

    // Method-level middleware
    const methodMiddlewares: MiddlewareHandler[] =
      Reflect.getMetadata(METADATA.METHOD_MIDDLEWARES, controllerClass, route.handlerName) || []

    // Build handler chain
    const handlers: any[] = []

    // Validation middleware (shared with standalone validate() export)
    if (route.validation) {
      handlers.push(validate(route.validation))
    }

    // @FileUpload decorator — auto-attach upload middleware from metadata
    const fileUploadConfig: FileUploadConfig | undefined = Reflect.getMetadata(
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
