export function generateModuleIndex(
  pascal: string,
  kebab: string,
  plural: string,
  repo: 'drizzle' | 'inmemory',
): string {
  const repoClass =
    repo === 'inmemory' ? `InMemory${pascal}Repository` : `Drizzle${pascal}Repository`
  const repoFile = repo === 'inmemory' ? `in-memory-${kebab}` : `drizzle-${kebab}`

  return `/**
 * ${pascal} Module
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
import { ${pascal.toUpperCase()}_REPOSITORY } from './domain/repositories/${kebab}.repository'
import { ${repoClass} } from './infrastructure/repositories/${repoFile}.repository'
import { ${pascal}Controller } from './presentation/${kebab}.controller'

// Eagerly load decorated classes so @Service()/@Repository() decorators register in the DI container
import.meta.glob(
  ['./domain/services/**/*.ts', './application/use-cases/**/*.ts', '!./**/*.test.ts'],
  { eager: true },
)

export class ${pascal}Module implements AppModule {
  /**
   * Register module dependencies in the DI container.
   * Bind repository interface tokens to their implementations here.
   * To swap implementations (e.g. in-memory -> Drizzle), change the factory target.
   */
  register(container: Container): void {
    container.registerFactory(${pascal.toUpperCase()}_REPOSITORY, () =>
      container.resolve(${repoClass}),
    )
  }

  /**
   * Declare HTTP routes for this module.
   * The path is prefixed with the global apiPrefix and version (e.g. /api/v1/${plural}).
   * Passing 'controller' enables automatic OpenAPI spec generation via SwaggerAdapter.
   */
  routes(): ModuleRoutes {
    return {
      path: '/${plural}',
      router: buildRoutes(${pascal}Controller),
      controller: ${pascal}Controller,
    }
  }
}
`
}
