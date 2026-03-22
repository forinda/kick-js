import type { AppModule, ModuleRoutes, Container } from '@forinda/kickjs-core';
import { buildRoutes } from '@forinda/kickjs-http';
import { TOKENS } from '@/shared/constants/tokens';
import { MongoProjectRepository } from './infrastructure/repositories/mongo-project.repository';
import { ProjectsController } from './presentation/projects.controller';

// Eagerly load decorated classes so @Service()/@Repository() decorators register in the DI container
import.meta.glob(
  ['./application/use-cases/**/*.ts', './infrastructure/repositories/**/*.ts', '!./**/*.test.ts'],
  { eager: true },
);

export class ProjectsModule implements AppModule {
  register(container: Container): void {
    container.registerFactory(TOKENS.PROJECT_REPOSITORY, () =>
      container.resolve(MongoProjectRepository),
    );
  }

  routes(): ModuleRoutes {
    return {
      path: '/',
      router: buildRoutes(ProjectsController),
      controller: ProjectsController,
    };
  }
}
