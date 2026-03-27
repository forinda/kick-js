import type { AppModule, ModuleRoutes, Container } from '@forinda/kickjs';
import { buildRoutes } from '@forinda/kickjs';
import { StatsController } from './presentation/stats.controller';

export class StatsModule implements AppModule {
  register(_container: Container): void {
    // No DI bindings needed
  }

  routes(): ModuleRoutes {
    return {
      path: '/',
      router: buildRoutes(StatsController),
      controller: StatsController,
    };
  }
}
