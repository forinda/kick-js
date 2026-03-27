import 'reflect-metadata';
import { Router } from 'express';
/** Get the controller path set by @Controller('/path') */
export declare function getControllerPath(controllerClass: any): string;
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
export declare function buildRoutes(controllerClass: any): Router;
//# sourceMappingURL=router-builder.d.ts.map