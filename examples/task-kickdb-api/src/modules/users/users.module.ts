import { type AppModule, type ModuleRoutes, buildRoutes } from '@forinda/kickjs'
import { UsersController } from './users.controller'

export class UsersModule implements AppModule {
  routes(): ModuleRoutes {
    return {
      path: '/users',
      router: buildRoutes(UsersController),
      controller: UsersController,
    }
  }
}
