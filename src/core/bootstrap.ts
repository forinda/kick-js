import { Container } from "inversify";
import type { BootstrapContext, CreateModuleResultType } from "./types";
import { KICK_MODULE_KEYS } from "./constants/di-keys";
import { mapController } from "./utils/controller-mapper";

export function bootstrapExpressApp({ app, modules }: BootstrapContext) {
  // Your bootstrap logic here
  console.log("Bootstrapping Express App");
  createAndLoadModules(modules);
  return app;
}

function createAndLoadModules(modules: CreateModuleResultType[]) {
  // Your module creation and loading logic here
  const container = new Container({ autobind: true });
  modules.forEach((module) => {
    console.log(`[MODULE]: loading ${module.name}`);
    module.install(container);
  });
  const controllers = container.getAll<any>(
    KICK_MODULE_KEYS.KickControllerType
  );

}
