import type { KickRequest, KickResponse, KickNextFn, KickRequestContext } from "../types";
import type { KickRouteMetadata } from "../types/route";
import { combineRoutePaths } from "./normalize-route-path";

/**
 * Route mapper utility for creating contextual handlers
 */
export class RouteMapper {
  /**
   * Creates a contextual handler that injects request context into controller methods
   * @param controller - The controller instance
   * @param route - The route metadata
   * @param prefix - Optional prefix to prepend to route paths
   * @returns Express-compatible handler function
   */
  static createContextualHandler(
    controller: any, 
    route: KickRouteMetadata, 
    prefix: string = ""
  ) {
    return (req: KickRequest, res: KickResponse, next: KickNextFn) => {
      // Generate unique request ID
      const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Create request context
      const requestContext: KickRequestContext = {
        req,
        res,
        next,
        meta: {
          routePath: RouteMapper.buildRoutePath(prefix, route.path),
          method: route.method,
          controllerName: controller.constructor.name,
          handlerName: route.handlerName,
          startTime: Date.now(),
          requestId
        }
      };
      
      try {
        // Call the controller method with the request context
        const result = route.handler.call(controller, requestContext);
        
        // Handle async controller methods
        if (result instanceof Promise) {
          result.catch((error) => {
            console.error(`[${controller.constructor.name}:${route.handlerName}] Error:`, error);
            if (!res.headersSent) {
              res.status(500).json({ 
                error: 'Internal Server Error',
                requestId: requestContext.meta.requestId
              });
            }
          });
        }
        
        return result;
      } catch (error) {
        console.error(`[${controller.constructor.name}:${route.handlerName}] Error:`, error);
        if (!res.headersSent) {
          res.status(500).json({ 
            error: 'Internal Server Error',
            requestId: requestContext.meta.requestId
          });
        }
      }
    };
  }

  /**
   * Builds the full route path by combining prefix and route path
   * @param prefix - The prefix to prepend
   * @param routePath - The route path
   * @returns Combined route path
   */
  static buildRoutePath(prefix: string, routePath: string): string {
    // Normalize prefix and route path
    const normalizedPrefix = prefix.replace(/\/+$/, ''); // Remove trailing slashes
    const normalizedRoutePath = routePath.startsWith('/') ? routePath : `/${routePath}`;
    
    // If prefix is empty, just return the route path
    if (!normalizedPrefix) {
      return normalizedRoutePath;
    }
    
    // Combine prefix and route path
    return combineRoutePaths(normalizedPrefix, normalizedRoutePath);
  }

  /**
   * Maps a controller to its routes with optional prefix
   * @param controller - The controller instance
   * @param routes - The route metadata array
   * @param prefix - Optional prefix to prepend to all routes
   * @returns Array of mapped route information
   */
  static mapControllerRoutes(
    controller: any, 
    routes: KickRouteMetadata[], 
    prefix: string = ""
  ) {
    return routes.map(route => ({
      ...route,
      fullPath: RouteMapper.buildRoutePath(prefix, route.path),
      handler: RouteMapper.createContextualHandler(controller, route, prefix),
      controllerName: controller.constructor.name
    }));
  }

  /**
   * Logs route registration information
   * @param method - HTTP method
   * @param path - Route path
   * @param handlerName - Handler method name
   * @param controllerName - Controller class name
   * @param prefix - Optional prefix used
   */
  static logRouteRegistration(
    method: string, 
    path: string, 
    handlerName: string, 
    controllerName: string,
    prefix?: string
  ) {
    const _prefixInfo = prefix ? ` [prefix: ${prefix}]` : '';
    // console.log(`[ROUTE]: ${method} ${path} -> ${controllerName}.${handlerName}${prefixInfo}`);
  }
}