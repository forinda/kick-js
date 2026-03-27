import { Container, type AppModule, type ModuleRoutes } from '@forinda/kickjs-core'
import { buildRoutes } from '@forinda/kickjs-http'
import { TOKENS } from '@/shared/constants/tokens'
import { PROJECT_REPOSITORY } from './domain/repositories/project.repository'
import { PrismaProjectRepository } from './infrastructure/repositories/prisma-project.repository'
import { ProjectController } from './presentation/project.controller'

import.meta.glob(
  ['./domain/services/**/*.ts', './application/use-cases/**/*.ts', '!./**/*.test.ts'],
  { eager: true },
)

export class ProjectModule implements AppModule {
  register(container: Container): void {
    const factory = () => container.resolve(PrismaProjectRepository)
    container.registerFactory(PROJECT_REPOSITORY, factory)
    container.registerFactory(TOKENS.PROJECT_REPOSITORY, factory)
  }

  routes(): ModuleRoutes {
    return {
      path: '/projects',
      router: buildRoutes(ProjectController),
      controller: ProjectController,
    }
  }
}
