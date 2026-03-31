import { type AppModule, type ModuleRoutes, type Container, buildRoutes } from '@forinda/kickjs'
import { TASK_REPOSITORY } from './domain/task.entity'
import { InMemoryTaskRepository } from './infrastructure/in-memory-task.repository'
import { TaskController } from './presentation/task.controller'

export class TaskModule implements AppModule {
  register(container: Container): void {
    container.registerFactory(TASK_REPOSITORY, () =>
      container.resolve(InMemoryTaskRepository),
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
