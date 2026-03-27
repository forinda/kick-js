import { Container, type AppModule, type ModuleRoutes } from '@forinda/kickjs'
import { buildRoutes } from '@forinda/kickjs'
import { LABEL_REPOSITORY } from './domain/repositories/label.repository'
import { TASK_LABEL_REPOSITORY } from './domain/repositories/task-label.repository'
import { PrismaLabelRepository } from './infrastructure/repositories/prisma-label.repository'
import { PrismaTaskLabelRepository } from './infrastructure/repositories/prisma-task-label.repository'
import { LabelController } from './presentation/label.controller'

import.meta.glob(
  ['./domain/services/**/*.ts', './application/use-cases/**/*.ts', '!./**/*.test.ts'],
  { eager: true },
)

export class LabelModule implements AppModule {
  register(container: Container): void {
    container.registerFactory(LABEL_REPOSITORY, () => container.resolve(PrismaLabelRepository))
    container.registerFactory(TASK_LABEL_REPOSITORY, () =>
      container.resolve(PrismaTaskLabelRepository),
    )
  }

  routes(): ModuleRoutes {
    return {
      path: '/labels',
      router: buildRoutes(LabelController),
      controller: LabelController,
    }
  }
}
