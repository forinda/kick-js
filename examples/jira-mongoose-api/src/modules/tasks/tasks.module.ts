import type { AppModule, ModuleRoutes, Container } from '@forinda/kickjs-core';
import { buildRoutes } from '@forinda/kickjs-http';
import { TOKENS } from '@/shared/constants/tokens';
import { MongoTaskRepository } from './infrastructure/repositories/mongo-task.repository';
import { TasksController } from './presentation/tasks.controller';

// Eagerly load decorated classes so @Service()/@Repository() decorators register in the DI container
import.meta.glob(
  ['./application/use-cases/**/*.ts', './infrastructure/repositories/**/*.ts', '!./**/*.test.ts'],
  { eager: true },
);

export class TasksModule implements AppModule {
  register(container: Container): void {
    container.registerFactory(TOKENS.TASK_REPOSITORY, () =>
      container.resolve(MongoTaskRepository),
    );
  }

  routes(): ModuleRoutes {
    return {
      path: '/',
      router: buildRoutes(TasksController),
      controller: TasksController,
    };
  }
}
