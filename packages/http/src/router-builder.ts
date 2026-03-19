import 'reflect-metadata'
import { Router, type Request, type Response, type NextFunction } from 'express'
import {
  Container,
  METADATA,
  type RouteDefinition,
  type MiddlewareHandler,
} from '@kickjs/core'
import { RequestContext } from './context'
import { validate } from './middleware/validate'

/** Get the controller path set by @Controller('/path') */
export function getControllerPath(controllerClass: any): string {
  return Reflect.getMetadata(METADATA.CONTROLLER_PATH, controllerClass) || '/'
}

/**
 * Build an Express Router from a controller class decorated with @Get, @Post, etc.
 * Resolves the controller from the DI container, wraps handlers in RequestContext,
 * and applies class-level and method-level middleware.
 */
export function buildRoutes(controllerClass: any): Router {
  const router = Router()
  const container = Container.getInstance()
  const controller = container.resolve(controllerClass)
  const controllerPath = getControllerPath(controllerClass)
  const routes: RouteDefinition[] =
    Reflect.getMetadata(METADATA.ROUTES, controllerClass) || []

  // Class-level middleware
  const classMiddlewares: MiddlewareHandler[] =
    Reflect.getMetadata(METADATA.CLASS_MIDDLEWARES, controllerClass) || []

  for (const route of routes) {
    const method = route.method.toLowerCase() as 'get' | 'post' | 'put' | 'delete' | 'patch'
    let routePath = route.path === '/' ? '' : route.path
    const fullPath = controllerPath === '/' ? routePath || '/' : controllerPath + routePath

    // Method-level middleware
    const methodMiddlewares: MiddlewareHandler[] =
      Reflect.getMetadata(METADATA.METHOD_MIDDLEWARES, controllerClass, route.handlerName) || []

    // Build handler chain
    const handlers: any[] = []

    // Validation middleware (shared with standalone validate() export)
    if (route.validation) {
      handlers.push(validate(route.validation))
    }

    // Class + method middleware (wrapped as Express middleware)
    for (const mw of [...classMiddlewares, ...methodMiddlewares]) {
      handlers.push((req: Request, res: Response, next: NextFunction) => {
        const ctx = new RequestContext(req, res, next)
        return mw(ctx, next)
      })
    }

    // Main handler
    handlers.push(async (req: Request, res: Response, next: NextFunction) => {
      const ctx = new RequestContext(req, res, next)
      try {
        await controller[route.handlerName](ctx)
      } catch (err: any) {
        next(err)
      }
    })

    ;(router as any)[method](fullPath, ...handlers)
  }

  return router
}

