/**
 * User Module
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
import { Container, type AppModule, type ModuleRoutes } from '@forinda/kickjs'
import { buildRoutes } from '@forinda/kickjs'
import { USER_REPOSITORY } from './domain/repositories/user.repository'
import { TOKENS } from '@/shared/constants/tokens'
import { DrizzleUserRepository } from './infrastructure/repositories/drizzle-user.repository'
import { UserController } from './presentation/user.controller'

// Eagerly load decorated classes so @Service()/@Repository() decorators register in the DI container
import.meta.glob(
  ['./domain/services/**/*.ts', './application/use-cases/**/*.ts', '!./**/*.test.ts'],
  { eager: true },
)

export class UserModule implements AppModule {
  register(container: Container): void {
    const factory = () => container.resolve(DrizzleUserRepository)
    container.registerFactory(USER_REPOSITORY, factory)
    // Also register under shared TOKENS so other modules (auth) can resolve it
    container.registerFactory(TOKENS.USER_REPOSITORY, factory)
  }

  /**
   * Declare HTTP routes for this module.
   * The path is prefixed with the global apiPrefix and version (e.g. /api/v1/users).
   * Passing 'controller' enables automatic OpenAPI spec generation via SwaggerAdapter.
   */
  routes(): ModuleRoutes {
    return {
      path: '/users',
      router: buildRoutes(UserController),
      controller: UserController,
    }
  }
}
