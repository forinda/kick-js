/**
 * Users Module
 *
 * Self-contained feature module following Domain-Driven Design (DDD).
 * Registers dependencies in the DI container and declares HTTP routes.
 *
 * Structure:
 *   presentation/    — HTTP controllers (entry points)
 *   application/     — Use cases (orchestration) and DTOs (validation)
 *   domain/          — Entities, value objects, repository interfaces, domain services
 *   infrastructure/  — Repository implementations (in-memory, Drizzle, Prisma, etc.)
 */
import { Container, type AppModule, type ModuleRoutes } from '@forinda/kickjs-core'
import { buildRoutes } from '@forinda/kickjs-http'
import { USERS_REPOSITORY } from './domain/repositories/users.repository'
import { DrizzleUsersRepository } from './infrastructure/repositories/drizzle-users.repository'
import { UsersController } from './presentation/users.controller'

// Eagerly load decorated classes so @Service()/@Repository() decorators register in the DI container
import.meta.glob(
  ['./domain/services/**/*.ts', './application/use-cases/**/*.ts', '!./**/*.test.ts'],
  { eager: true },
)

export class UsersModule implements AppModule {
  /**
   * Register module dependencies in the DI container.
   * Bind repository interface tokens to their implementations here.
   * To swap implementations (e.g. in-memory -> Drizzle), change the factory target.
   */
  register(container: Container): void {
    container.registerFactory(USERS_REPOSITORY, () =>
      container.resolve(DrizzleUsersRepository),
    )
  }

  /**
   * Declare HTTP routes for this module.
   * The path is prefixed with the global apiPrefix and version (e.g. /api/v1/users).
   * Passing 'controller' enables automatic OpenAPI spec generation via SwaggerAdapter.
   */
  routes(): ModuleRoutes {
    return {
      path: '/users',
      router: buildRoutes(UsersController),
      controller: UsersController,
    }
  }
}
