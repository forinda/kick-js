import { KICK_CONTROLLER_METADATA_KEYS } from "../constants/di-keys";
import type { CreateRouteType, KickRouteMetadata } from "../types/route";

type KickRouteOptions = {
  method:
    | "GET"
    | "POST"
    | "PUT"
    | "DELETE"
    | "OPTIONS"
    | "HEAD"
    | "PATCH"
    | "TRACE"
    | "CONNECT"
    | "ALL";
};

function createKickRoute(createOptions: KickRouteOptions) {
  /**
   * @decorator `KickRoute`:
   * Decorator to define a route on a controller method.
   * @param {string} path
   * @param {CreateRouteType} options
   * @returns {Function}
   */
  return function <PathName extends string>(
    path: PathName,
    options: CreateRouteType = {}
  ) {
    return function (
      target: any,
      propertyKey: PropertyKey,
      descriptor: PropertyDescriptor
    ) {
      if (typeof descriptor.value !== "function") {
        throw new Error(
          "[KickRoute] Decorator can only be applied to methods."
        );
      }
      /**
       * Register route metadata
       * @param {KickRouteMetadata} routeMetadata
       */
      const routeMetadata: KickRouteMetadata = {
        path,
        method: createOptions.method,
        handlerName: propertyKey as string,
        handler: descriptor.value,
        middlewares: options.middlewares ?? [],
      };
      // Update the existing routes metadata in the controller
      const existingRoutes =
        Reflect.getMetadata(
          KICK_CONTROLLER_METADATA_KEYS.routes,
          target.constructor
        ) || [];
      existingRoutes.push(routeMetadata);
      Reflect.defineMetadata(
        KICK_CONTROLLER_METADATA_KEYS.routes,
        existingRoutes,
        target.constructor
      );
    };
  };
}
export function KickGet<PathName extends string>(
  path: PathName,
  options?: CreateRouteType
) {
  return createKickRoute({ method: "GET" })(path, options);
}
export function KickPost<PathName extends string>(
  path: PathName,
  options?: CreateRouteType
) {
  return createKickRoute({ method: "POST" })(path, options);
}
export function KickPut<PathName extends string>(
  path: PathName,
  options?: CreateRouteType
) {
  return createKickRoute({ method: "PUT" })(path, options);
}
export function KickPatch<PathName extends string>(
  path: PathName,
  options?: CreateRouteType
) {
  return createKickRoute({ method: "PATCH" })(path, options);
}
export function KickDelete<PathName extends string>(
  path: PathName,
  options?: CreateRouteType
) {
  return createKickRoute({ method: "DELETE" })(path, options);
}
