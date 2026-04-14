import { type AppModule, type ModuleRoutes, buildRoutes } from '@forinda/kickjs'
import { ProjectController } from './project.controller'

export class ProjectModule implements AppModule {
  routes(): ModuleRoutes {
    return {
      path: '/projects',
      router: buildRoutes(ProjectController),
      controller: ProjectController,
    }
  }
}
