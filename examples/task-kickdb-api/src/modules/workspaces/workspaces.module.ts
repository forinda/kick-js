import { type AppModule, type ModuleRoutes, buildRoutes } from '@forinda/kickjs'
import { WorkspacesController } from './workspaces.controller'

export class WorkspacesModule implements AppModule {
  routes(): ModuleRoutes {
    return {
      path: '/workspaces',
      router: buildRoutes(WorkspacesController),
      controller: WorkspacesController,
    }
  }
}
