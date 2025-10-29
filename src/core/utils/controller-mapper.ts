import { KICK_CONTROLLER_METADATA_KEYS } from "../constants/di-keys";
import type { ModuleController } from "../types";
import type { KickControllerOptions, KickRouteMetadata } from "../types/route";
import { combineRoutePaths } from "./normalize-route-path";

/**
 * Map the controller metadata to a route configuration
 * @param {ModuleController} controller
 * @returns {KickRouteMetadata[]}
 */
export function mapController(controller: ModuleController) {
  const basePath: string =
    Reflect.getMetadata(
      KICK_CONTROLLER_METADATA_KEYS.path,
      controller.constructor
    ) || "";
  const routes: KickRouteMetadata[] =
    Reflect.getMetadata(
      KICK_CONTROLLER_METADATA_KEYS.routes,
      controller.constructor
    ) || [];
  const baseOptions: KickControllerOptions =
    Reflect.getMetadata(
      KICK_CONTROLLER_METADATA_KEYS.options,
      controller.constructor
    ) || {};
  /**
   * TODO: Add more metadata mapping if needed
   */
  return routes.map((route) => ({
    ...route,
    path: combineRoutePaths(basePath, route.path),
    middlewares: [
      ...(baseOptions.middlewares || []),
      ...(route.middlewares || []),
    ],
  }));
}
