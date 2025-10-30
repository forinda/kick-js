import type { KickRequest, KickResponse, KickNextFn } from "./http";

/**
 * Request context that gets injected into controller methods
 * Contains all the necessary Express objects and metadata for handling HTTP requests
 */
export interface KickRequestContext {
  /**
   * Express request object
   */
  req: KickRequest;
  
  /**
   * Express response object
   */
  res: KickResponse;
  
  /**
   * Express next function for middleware chaining
   */
  next: KickNextFn;
  
  /**
   * Additional metadata about the request/route
   */
  meta: {
    /**
     * The route path pattern (e.g., "/todos/:id")
     */
    routePath: string;
    
    /**
     * The HTTP method (GET, POST, etc.)
     */
    method: string;
    
    /**
     * The controller class name
     */
    controllerName: string;
    
    /**
     * The handler method name
     */
    handlerName: string;
    
    /**
     * Timestamp when the request started processing
     */
    startTime: number;
    
    /**
     * Request ID for tracking/logging
     */
    requestId: string;
  };
}