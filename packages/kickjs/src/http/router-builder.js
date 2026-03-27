import 'reflect-metadata';
import { Router } from 'express';
import { Container, METADATA, } from '../core';
import { RequestContext } from './context';
import { validate } from './middleware/validate';
import { buildUploadMiddleware } from './middleware/upload';
/** Get the controller path set by @Controller('/path') */
export function getControllerPath(controllerClass) {
    return Reflect.getMetadata(METADATA.CONTROLLER_PATH, controllerClass) || '/';
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
export function buildRoutes(controllerClass) {
    const router = Router();
    const container = Container.getInstance();
    const routes = Reflect.getMetadata(METADATA.ROUTES, controllerClass) || [];
    // Class-level middleware
    const classMiddlewares = Reflect.getMetadata(METADATA.CLASS_MIDDLEWARES, controllerClass) || [];
    for (const route of routes) {
        const method = route.method.toLowerCase();
        const fullPath = route.path || '/';
        // Method-level middleware
        const methodMiddlewares = Reflect.getMetadata(METADATA.METHOD_MIDDLEWARES, controllerClass, route.handlerName) || [];
        // Build handler chain
        const handlers = [];
        // Validation middleware (shared with standalone validate() export)
        if (route.validation) {
            handlers.push(validate(route.validation));
        }
        // @FileUpload decorator — auto-attach upload middleware from metadata
        const fileUploadConfig = Reflect.getMetadata(METADATA.FILE_UPLOAD, controllerClass, route.handlerName);
        if (fileUploadConfig) {
            handlers.push(buildUploadMiddleware(fileUploadConfig));
        }
        // Class + method middleware (wrapped as Express middleware with error catching)
        for (const mw of [...classMiddlewares, ...methodMiddlewares]) {
            handlers.push((req, res, next) => {
                const ctx = new RequestContext(req, res, next);
                Promise.resolve(mw(ctx, next)).catch(next);
            });
        }
        // Main handler — resolve controller per-request to respect DI scoping
        handlers.push(async (req, res, next) => {
            const ctx = new RequestContext(req, res, next);
            try {
                const controller = container.resolve(controllerClass);
                await controller[route.handlerName](ctx);
            }
            catch (err) {
                next(err);
            }
        });
        router[method](fullPath, ...handlers);
    }
    return router;
}
//# sourceMappingURL=router-builder.js.map