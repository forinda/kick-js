import { Container, type AppModule, type ModuleRoutes } from '@forinda/kickjs-core'
import { buildRoutes } from '@forinda/kickjs-http'
import { TOKENS } from '@/shared/constants/tokens'
import { TASK_REPOSITORY } from './domain/repositories/task.repository'
import { DrizzleTaskRepository } from './infrastructure/repositories/drizzle-task.repository'
import { DrizzleTaskAssigneeRepository } from './infrastructure/repositories/drizzle-task-assignee.repository'
import { TaskController } from './presentation/task.controller'

import.meta.glob(
  ['./domain/services/**/*.ts', './application/use-cases/**/*.ts', '!./**/*.test.ts'],
  { eager: true },
)

export class TaskModule implements AppModule {
  register(container: Container): void {
    const taskFactory = () => container.resolve(DrizzleTaskRepository)
    container.registerFactory(TASK_REPOSITORY, taskFactory)
    container.registerFactory(TOKENS.TASK_REPOSITORY, taskFactory)

    container.registerFactory(TOKENS.TASK_ASSIGNEE_REPOSITORY, () =>
      container.resolve(DrizzleTaskAssigneeRepository),
    )
  }

  routes(): ModuleRoutes {
    return {
      path: '/tasks',
      router: buildRoutes(TaskController),
      controller: TaskController,
    }
  }
}
