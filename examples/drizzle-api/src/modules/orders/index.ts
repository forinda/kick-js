/**
 * Orders Module
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
import { ORDERS_REPOSITORY } from './domain/repositories/orders.repository'
import { InMemoryOrdersRepository } from './infrastructure/repositories/in-memory-orders.repository'
import { OrdersController } from './presentation/orders.controller'

// Eagerly load decorated classes so @Service()/@Repository() decorators register in the DI container
import.meta.glob(
  ['./domain/services/**/*.ts', './application/use-cases/**/*.ts', '!./**/*.test.ts'],
  { eager: true },
)

export class OrdersModule implements AppModule {
  /**
   * Register module dependencies in the DI container.
   * Bind repository interface tokens to their implementations here.
   * To swap implementations (e.g. in-memory -> Drizzle), change the factory target.
   */
  register(container: Container): void {
    container.registerFactory(ORDERS_REPOSITORY, () =>
      container.resolve(InMemoryOrdersRepository),
    )
  }

  /**
   * Declare HTTP routes for this module.
   * The path is prefixed with the global apiPrefix and version (e.g. /api/v1/orders).
   * Passing 'controller' enables automatic OpenAPI spec generation via SwaggerAdapter.
   */
  routes(): ModuleRoutes {
    return {
      path: '/orders',
      router: buildRoutes(OrdersController),
      controller: OrdersController,
    }
  }
}
