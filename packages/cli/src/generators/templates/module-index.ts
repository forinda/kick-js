import type { RepoType } from '../module'
import type { TemplateContext } from './types'

const repoLabelMap: Record<string, string> = {
  inmemory: 'in-memory',
  drizzle: 'Drizzle',
  prisma: 'Prisma',
}

function toPascalRepoType(repo: string): string {
  return (
    repo.charAt(0).toUpperCase() +
    repo.slice(1).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
  )
}

function toKebabRepoType(repo: string): string {
  return repo.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
}

function repoLabel(repo: RepoType): string {
  return repoLabelMap[repo] ?? toPascalRepoType(repo)
}

function repoMaps(pascal: string, kebab: string, repo: RepoType) {
  const repoClassMap: Record<string, string> = {
    inmemory: `InMemory${pascal}Repository`,
    drizzle: `Drizzle${pascal}Repository`,
    prisma: `Prisma${pascal}Repository`,
  }
  const repoFileMap: Record<string, string> = {
    inmemory: `in-memory-${kebab}`,
    drizzle: `drizzle-${kebab}`,
    prisma: `prisma-${kebab}`,
  }
  return {
    repoClass: repoClassMap[repo] ?? `${toPascalRepoType(repo)}${pascal}Repository`,
    repoFile: repoFileMap[repo] ?? `${toKebabRepoType(repo)}-${kebab}`,
  }
}

/** DDD module index — nested folders, use-cases, domain services */
export function generateModuleIndex(ctx: TemplateContext & { repo: RepoType }): string {
  const { pascal, kebab, plural = '', repo } = ctx
  const { repoClass, repoFile } = repoMaps(pascal, kebab, repo)

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
 *   infrastructure/  — Repository implementations (currently ${repoLabel(repo)})
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
   * Currently wired to ${repoLabel(repo)}. To swap implementations, change the factory target.
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

/** REST module index — flat folder, service + controller, no use-cases */
export function generateRestModuleIndex(ctx: TemplateContext & { repo: RepoType }): string {
  const { pascal, kebab, plural = '', repo } = ctx
  const { repoClass, repoFile } = repoMaps(pascal, kebab, repo)

  return `/**
 * ${pascal} Module
 *
 * REST module with a flat folder structure.
 * Controller delegates to service, service wraps the repository.
 *
 * Structure:
 *   ${kebab}.controller.ts  — HTTP routes (CRUD)
 *   ${kebab}.service.ts     — Business logic
 *   ${kebab}.repository.ts  — Repository interface
 *   ${repoFile}.repository.ts — Repository implementation
 *   dtos/                   — Request/response schemas
 */
import { Container, type AppModule, type ModuleRoutes } from '@forinda/kickjs-core'
import { buildRoutes } from '@forinda/kickjs-http'
import { ${pascal.toUpperCase()}_REPOSITORY } from './${kebab}.repository'
import { ${repoClass} } from './${repoFile}.repository'
import { ${pascal}Controller } from './${kebab}.controller'

// Eagerly load decorated classes so @Service()/@Repository() decorators register in the DI container
import.meta.glob(['./**/*.service.ts', './**/*.repository.ts', '!./**/*.test.ts'], { eager: true })

export class ${pascal}Module implements AppModule {
  register(container: Container): void {
    container.registerFactory(${pascal.toUpperCase()}_REPOSITORY, () =>
      container.resolve(${repoClass}),
    )
  }

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

/** Minimal module index — just controller, no service/repo */
export function generateMinimalModuleIndex(ctx: TemplateContext): string {
  const { pascal, kebab, plural = '' } = ctx
  return `import { type AppModule, type ModuleRoutes } from '@forinda/kickjs-core'
import { buildRoutes } from '@forinda/kickjs-http'
import { ${pascal}Controller } from './${kebab}.controller'

export class ${pascal}Module implements AppModule {
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
