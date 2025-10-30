import type {
    Container as KickContainer,
    Newable as KickNewable,
} from "inversify";

/**
 * Represents a controller class that can be instantiated.
 * Used in module creation to register controllers.
 */
export type KickModuleController = KickNewable<any>;

/**
 * Represents a middleware class that can be instantiated.
 * Used in module creation to register middlewares.
 */
export type KickModuleMiddleware = KickNewable<any>;

/**
 * Options for creating a module.
 * Includes arrays of controllers and middlewares to be registered in the module.
 */
export type KickCreateModuleOptionsType = {
    controllers?: KickModuleController[];
    middlewares?: KickModuleMiddleware[];
};
/**
 * The result of createModule function.
 * Provides an install method to load the module into a dependency container.
 */

export type KickCreateModuleResultType = {
    install: (container: KickContainer) => void;
    name: string;
};
/**
 * Function type for creating a module.
 * Takes `CreateModuleOptionsType` and returns `CreateModuleResultType`.
 * @param {string} name - The name of the module.
 * @param {KickCreateModuleOptionsType} options
 * @returns {KickCreateModuleResultType}
 */
export type CreateModuleFuncType = <N extends string = "BaseModule">(
    name: N,
    options: KickCreateModuleOptionsType
) => KickCreateModuleResultType;
