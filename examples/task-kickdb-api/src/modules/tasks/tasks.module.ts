import { type AppModule, type ModuleRoutes, buildRoutes } from '@forinda/kickjs'
import { TasksController } from './tasks.controller'

export class TasksModule implements AppModule {
  routes(): ModuleRoutes {
    return {
      path: '/tasks',
      router: buildRoutes(TasksController),
      controller: TasksController,
    }
  }
}
