import type { Container, Newable } from "inversify";

/**
 * Represents a controller class that can be instantiated.
 * Used in module creation to register controllers.
 */
export type ModuleController = Newable<any>;
/**
 * Options for creating a module.
 * Includes an array of controllers to be registered in the module.
 */
export type CreateModuleOptionsType = {
  controllers?: ModuleController[];
};
/**
 * The result of createModule function.
 * Provides an install method to load the module into a dependency container.
 */

export type CreateModuleResultType = {
  install: (container: Container) => void;
  name: string;
};
/**
 * Function type for creating a module.
 * Takes `CreateModuleOptionsType` and returns `CreateModuleResultType`.
 * @param {string} name - The name of the module. 
 * @param {CreateModuleOptionsType} options
 * @returns {CreateModuleResultType}
 */
export type CreateModuleFuncType = <N extends string = "BaseModule">(
  name: N,
  options: CreateModuleOptionsType
) => CreateModuleResultType;
