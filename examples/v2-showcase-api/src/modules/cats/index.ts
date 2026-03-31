/**
 * Cat Module
 *
 * Self-contained feature module following Domain-Driven Design (DDD).
 * Registers dependencies in the DI container and declares HTTP routes.
 *
 * Structure:
 *   presentation/    — HTTP controllers (entry points)
 *   application/     — Use cases (orchestration) and DTOs (validation)
 *   domain/          — Entities, value objects, repository interfaces, domain services
 *   infrastructure/  — Repository implementations (currently in-memory)
 */
import { Container, type AppModule, type ModuleRoutes } from '@forinda/kickjs'
import { buildRoutes } from '@forinda/kickjs'
import { CAT_REPOSITORY } from './domain/repositories/cat.repository'
import { InMemoryCatRepository } from './infrastructure/repositories/in-memory-cat.repository'
import { CatController } from './presentation/cat.controller'

// Eagerly import decorated classes so @Service()/@Repository() decorators register in the DI container
import './domain/services/cat-domain.service'
import './application/use-cases/create-cat.use-case'
import './application/use-cases/get-cat.use-case'
import './application/use-cases/list-cats.use-case'
import './application/use-cases/update-cat.use-case'
import './application/use-cases/delete-cat.use-case'

export class CatModule implements AppModule {
  /**
   * Register module dependencies in the DI container.
   * Bind repository interface tokens to their implementations here.
   * Currently wired to in-memory. To swap implementations, change the factory target.
   */
  register(container: Container): void {
    container.registerFactory(CAT_REPOSITORY, () =>
      container.resolve(InMemoryCatRepository),
    )
  }

  /**
   * Declare HTTP routes for this module.
   * The path is prefixed with the global apiPrefix and version (e.g. /api/v1/cats).
   * Passing 'controller' enables automatic OpenAPI spec generation via SwaggerAdapter.
   */
  routes(): ModuleRoutes {
    return {
      path: '/cats',
      router: buildRoutes(CatController),
      controller: CatController,
    }
  }
}
