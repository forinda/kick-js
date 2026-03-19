/**
 * Task Module — demonstrates Joi-based validation with KickJS.
 *
 * This module uses a flat structure (no DDD layers) to show that KickJS
 * doesn't force you into DDD — you can use whatever structure fits your needs.
 */
import { type AppModule, type ModuleRoutes } from '@kickjs/core'
import { buildRoutes } from '@kickjs/http'
import { TaskController } from '../../controllers/task.controller'

export class TaskModule implements AppModule {
  register(): void {
    // No DI bindings needed — TaskController is self-contained with an in-memory store
  }

  routes(): ModuleRoutes {
    return {
      path: '/tasks',
      router: buildRoutes(TaskController),
      controller: TaskController,
    }
  }
}
