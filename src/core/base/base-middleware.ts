import { KickAppMiddleware } from "../types/application";
import { KickRequestHandler } from "../types/http";

export abstract class BaseKickMiddleware implements KickAppMiddleware {
  /**
   * The middleware function to be implemented by subclasses.
   * This function will be called with the request, response, and next function.
   */
  abstract use: KickRequestHandler;
}
