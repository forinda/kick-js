import { decorate, injectable } from "inversify";
import type { KickControllerOptions } from "../types/route";
import { KICK_CONTROLLER_METADATA_KEYS } from "../constants/di-keys";


/**
 * @author Felix Orinda
 * @decorator `KickController`:
 * Decorator to define a controller with a base path and options.
 * Also marks the class as injectable for DI.
 * @param {string} path 
 * @param {KickControllerOptions} options 
 * @returns 
 */
export function KickController<PathName extends string>(
  path: PathName,
  options?: KickControllerOptions
): ClassDecorator {
  return function (target: Function) {
    decorate(injectable('Request'), target);
    // Register the controller with the DI container
    Reflect.defineMetadata(KICK_CONTROLLER_METADATA_KEYS.path, path, target);
    Reflect.defineMetadata(
      KICK_CONTROLLER_METADATA_KEYS.options,
      options || {},
      target
    );
  };
}
