import type { AppModule, ModuleRoutes, Container } from '@forinda/kickjs';

export class CronModule implements AppModule {
  register(_container: Container): void {
    // Cron jobs are registered via CronAdapter in bootstrap
  }

  routes(): ModuleRoutes {
    return { path: '/', router: undefined as any, controller: undefined as any };
  }
}
