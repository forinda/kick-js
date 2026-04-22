import type { AppModule, ModuleRoutes, Container } from '@forinda/kickjs';
import { buildRoutes } from '@forinda/kickjs';
import { TOKENS } from '@/shared/constants/tokens';
import { MongoActivityRepository } from './infrastructure/repositories/mongo-activity.repository';
import { ActivityController } from './presentation/activity.controller';

// Eagerly load decorated classes so @Service()/@Repository() decorators register in the DI container
import.meta.glob(
  ['./infrastructure/repositories/**/*.ts', '!./**/*.test.ts'],
  { eager: true },
);

export class ActivityModule implements AppModule {
  register(container: Container): void {
    container.registerFactory(TOKENS.ACTIVITY_REPOSITORY, () =>
      container.resolve(MongoActivityRepository),
    );
  }

  routes(): ModuleRoutes {
    return {
      path: '/',
      router: buildRoutes(ActivityController),
      controller: ActivityController,
    };
  }
}
