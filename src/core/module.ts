import { Container, ContainerModule } from "inversify";
import { KICK_MODULE_KEYS } from "./constants/di-keys";
import type { CreateModuleFuncType, KickCreateModuleOptionsType } from "./types";
/**
 * Creates a module with the given options.
 * This module can then be installed into an Inversify container.
 * Helps load controllers and avoid duplicate bindings.
 * @param {KickCreateModuleOptionsType} options
 * @returns
 */
export const createModule: CreateModuleFuncType = <TName extends string>(
  name: TName,
  options: KickCreateModuleOptionsType
) => {
  const { controllers = [], middlewares = [] } = options;

  // Use Set to automatically handle duplicates by constructor reference
  const uniqueControllers = new Set(controllers);
  const uniqueMiddlewares = new Set(middlewares);

  const module = new ContainerModule(({ bind }) => {
    // Bind controllers
    uniqueControllers.forEach((controller) => {
      const bindingKey = KICK_MODULE_KEYS.KickControllerType;
      bind(bindingKey).to(controller);
      bind(controller).toSelf();
    });

    // Bind middlewares
    uniqueMiddlewares.forEach((middleware) => {
      const bindingKey = KICK_MODULE_KEYS.KickMiddlewareType;
      bind(bindingKey).to(middleware);
      bind(middleware).toSelf();
      console.log(`[Module:${name}] Registered middleware: ${middleware.name}`);
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
