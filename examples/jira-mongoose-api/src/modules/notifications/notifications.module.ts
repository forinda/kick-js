import type { AppModule, ModuleRoutes, Container } from '@forinda/kickjs';
import { buildRoutes } from '@forinda/kickjs';
import { TOKENS } from '@/shared/constants/tokens';
import { MongoNotificationRepository } from './infrastructure/repositories/mongo-notification.repository';
import { NotificationsController } from './presentation/notifications.controller';

// Eagerly load decorated classes so @Service()/@Repository() decorators register in the DI container
import.meta.glob(
  ['./infrastructure/repositories/**/*.ts', '!./**/*.test.ts'],
  { eager: true },
);

export class NotificationsModule implements AppModule {
  register(container: Container): void {
    container.registerFactory(TOKENS.NOTIFICATION_REPOSITORY, () =>
      container.resolve(MongoNotificationRepository),
    );
  }

  routes(): ModuleRoutes {
    return {
      path: '/notifications',
      router: buildRoutes(NotificationsController),
      controller: NotificationsController,
    };
  }
}
