import { Container, ContainerModule } from "inversify";
import { KICK_MODULE_KEYS } from "./constants/di-keys";
import type { CreateModuleFuncType, CreateModuleOptionsType } from "./types";
/**
 * Creates a module with the given options.
 * This module can then be installed into an Inversify container.
 * Helps load controllers and avoid duplicate bindings.
 * @param {CreateModuleOptionsType} options
 * @returns
 */
export const createModule: CreateModuleFuncType = <TName extends string>(
  name: TName,
  options: CreateModuleOptionsType
) => {
  const { controllers = [] } = options;

  // Use Set to automatically handle duplicates by constructor reference
  const uniqueControllers = new Set(controllers);

  const module = new ContainerModule(({ bind }) => {
    uniqueControllers.forEach((controller) => {
      const bindingKey = KICK_MODULE_KEYS.KickControllerType;
      bind(bindingKey).to(controller);
      bind(controller).toSelf();
    });
  });

  return {
    /**
     * Installs the module into the provided Inversify container.
     */
    install: (container: Container) => {
      container.load(module);
    },
    name,
  };
};
