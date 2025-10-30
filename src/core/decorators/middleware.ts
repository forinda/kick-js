import { decorate, injectable } from "inversify";
import { AutoBind } from "./auto-bind";
import { KICK_CONTROLLER_METADATA_KEYS } from "../constants/di-keys";

/**
 * KickMiddleware decorator options
 */
export interface KickMiddlewareOptions {
  /**
   * Optional name for the middleware (for logging/debugging)
   */
  name?: string;
  /**
   * Priority for middleware execution order (lower numbers execute first)
   */
  priority?: number;
  /**
   * Whether this middleware should be applied globally
   */
  global?: boolean;
  /**
   * Optional tags for categorizing middleware
   */
  tags?: string[];
}

/**
 * @decorator `KickMiddleware`:
 * Decorator to define a middleware class with automatic property binding and DI registration.
 * This decorator automatically applies AutoBind and makes the class injectable.
 * 
 * @param {KickMiddlewareOptions} options - Optional middleware configuration
 * @returns {ClassDecorator}
 * 
 * @example
 * ```typescript
 * @KickMiddleware({ name: 'Logger', priority: 1, global: true })
 * export class LoggerMiddleware extends BaseKickMiddleware {
 *   use = (req: KickRequest, res: KickResponse, next: KickNextFn) => {
 *     console.log(`${req.method} ${req.url}`);
 *     next();
 *   }
 * }
 * ```
 */
export function KickMiddleware(options: KickMiddlewareOptions = {}): ClassDecorator {
  return function (target: any) {
    // Apply AutoBind decorator to automatically bind all methods
    AutoBind(target);
    
    // Make the class injectable for DI
    decorate(injectable(), target);
    
    // Store middleware metadata
    const middlewareMetadata = {
      name: options.name || target.name,
      priority: options.priority || 0,
      global: options.global || false,
      tags: options.tags || [],
      className: target.name
    };
    
    // Define metadata on the class
    Reflect.defineMetadata(
      KICK_CONTROLLER_METADATA_KEYS.middlewareOptions, 
      middlewareMetadata, 
      target
    );
    
    // Mark as middleware type
    Reflect.defineMetadata(
      KICK_CONTROLLER_METADATA_KEYS.isMiddleware, 
      true, 
      target
    );
    
    // console.log(`[KickMiddleware]: Registered ${middlewareMetadata.name} middleware`);
  };
}

/**
 * Helper function to check if a class is a KickMiddleware
 */
export function isKickMiddleware(target: any): boolean {
  return Reflect.getMetadata(KICK_CONTROLLER_METADATA_KEYS.isMiddleware, target) === true;
}

/**
 * Helper function to get middleware metadata from a class
 */
export function getMiddlewareMetadata(target: any): KickMiddlewareOptions & { className: string } | undefined {
  return Reflect.getMetadata(KICK_CONTROLLER_METADATA_KEYS.middlewareOptions, target);
}