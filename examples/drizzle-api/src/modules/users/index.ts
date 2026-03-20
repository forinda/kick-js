import { type AppModule, type ModuleRoutes, type Container } from '@forinda/kickjs-core'
import { buildRoutes } from '@forinda/kickjs-http'
import { UsersController } from './users.controller'
import './users.service'

export class UsersModule implements AppModule {
  register(_container: Container): void {
    // UsersService auto-registered via @Service() decorator
  }

  routes(): ModuleRoutes {
    return {
      path: '/users',
      router: buildRoutes(UsersController),
      controller: UsersController,
    }
  }
}
