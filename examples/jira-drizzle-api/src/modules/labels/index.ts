import { Container, type AppModule, type ModuleRoutes } from '@forinda/kickjs-core'
import { buildRoutes } from '@forinda/kickjs-http'
import { LABEL_REPOSITORY } from './domain/repositories/label.repository'
import { TASK_LABEL_REPOSITORY } from './domain/repositories/task-label.repository'
import { DrizzleLabelRepository } from './infrastructure/repositories/drizzle-label.repository'
import { DrizzleTaskLabelRepository } from './infrastructure/repositories/drizzle-task-label.repository'
import { LabelController } from './presentation/label.controller'

import.meta.glob(
  ['./domain/services/**/*.ts', './application/use-cases/**/*.ts', '!./**/*.test.ts'],
  { eager: true },
)

export class LabelModule implements AppModule {
  register(container: Container): void {
    container.registerFactory(LABEL_REPOSITORY, () => container.resolve(DrizzleLabelRepository))
    container.registerFactory(TASK_LABEL_REPOSITORY, () =>
      container.resolve(DrizzleTaskLabelRepository),
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
