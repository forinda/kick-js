import { Container, type AppModule, type ModuleRoutes } from '@kickjs/core'
import { buildRoutes } from '@kickjs/http'
import { USERS_REPOSITORY } from './domain/repositories/users.repository'
import { InMemoryUsersRepository } from './infrastructure/repositories/in-memory-users.repository'
import { UsersController } from './presentation/users.controller'

import.meta.glob(
  ['./domain/services/**/*.ts', './application/use-cases/**/*.ts', '!./**/*.test.ts'],
  { eager: true },
)

export class UsersModule implements AppModule {
  register(container: Container): void {
    container.registerFactory(USERS_REPOSITORY, () =>
      container.resolve(InMemoryUsersRepository),
    )
  }

  routes(): ModuleRoutes {
    return {
      path: '/users',
      router: buildRoutes(UsersController),
      controller: UsersController,
    }
  }
}
