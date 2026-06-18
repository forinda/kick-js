import type { RepoType } from '../module'
import type { ModuleStyle, TemplateContext } from './types'

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

/** Resolve the style flag, defaulting to 'define' for new code. */
function resolveStyle(style?: ModuleStyle): ModuleStyle {
  return style ?? 'define'
}

/** DDD module index — nested folders, use-cases, domain services */
export function generateModuleIndex(ctx: TemplateContext & { repo: RepoType }): string {
  const { pascal, kebab, plural = '', repo, style } = ctx
  const { repoClass, repoFile } = repoMaps(pascal, kebab, repo)
  const resolvedStyle = resolveStyle(style)

  const header = `/**
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
 */`

  const repoImports = `import { ${pascal.toUpperCase()}_REPOSITORY } from './domain/repositories/${kebab}.repository'
import { ${repoClass} } from './infrastructure/repositories/${repoFile}.repository'
import { ${pascal}Controller } from './presentation/${kebab}.controller'

// Eagerly load decorated classes so @Controller()/@Service()/@Repository() decorators
// register in the DI container. Recursive globs (./**/) so the module keeps working
// however you nest files (e.g. moving controllers into a controllers/ sub-folder).
import.meta.glob(
  [
    './**/*.controller.ts',
    './**/*.service.ts',
    './**/*.repository.ts',
    './application/use-cases/**/*.ts',
    '!./**/*.test.ts',
  ],
  { eager: true },
)`

  const routesDoc = `    /**
     * Declare HTTP routes for this module. Return value shape:
     *
     *   - \`path\`        — URL prefix for this route set, mounted under
     *                     \`/{apiPrefix}/v{version}{path}\`.
     *   - \`controller\`  — Controller class. Used both for the route
     *                     handler bindings and OpenAPI spec generation.
     *   - \`version\`     — Optional. Overrides the app-wide API version
     *                     for this route set only.
     *
     * Return an **array** to mount multiple route sets under the
     * same module (e.g. side-by-side v1 + v2 controllers):
     *
     *   return [
     *     { path: '/${plural}', version: 1, controller: ${pascal}V1Controller },
     *     { path: '/${plural}', version: 2, controller: ${pascal}V2Controller },
     *   ]
     */`

  if (resolvedStyle === 'class') {
    return `${header}
import { Container, type AppModule, type ModuleRoutes } from '@forinda/kickjs'
${repoImports}

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

${routesDoc.replace(/^ {4}/gm, '  ').replace(/^ {6}/gm, '    ')}
  routes(): ModuleRoutes {
    return {
      path: '/${plural}',
      controller: ${pascal}Controller,
    }
  }
}
`
  }

  return `${header}
import { defineModule } from '@forinda/kickjs'
${repoImports}

export const ${pascal}Module = defineModule({
  name: '${pascal}Module',
  build: () => ({
    /**
     * Register module dependencies in the DI container.
     * Bind repository interface tokens to their implementations here.
     * Currently wired to ${repoLabel(repo)}. To swap implementations, change the factory target.
     */
    register(container) {
      container.registerFactory(${pascal.toUpperCase()}_REPOSITORY, () =>
        container.resolve(${repoClass}),
      )
    },

${routesDoc}
    routes() {
      return {
        path: '/${plural}',
        controller: ${pascal}Controller,
      }
    },
  }),
})
`
}

/** REST module index — flat folder, service + controller, no use-cases */
export function generateRestModuleIndex(ctx: TemplateContext & { repo: RepoType }): string {
  const { pascal, kebab, plural = '', repo, style } = ctx
  const { repoClass, repoFile } = repoMaps(pascal, kebab, repo)
  const resolvedStyle = resolveStyle(style)

  const header = `/**
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
 */`

  const repoImports = `import { ${pascal.toUpperCase()}_REPOSITORY } from './${kebab}.repository'
import { ${repoClass} } from './${repoFile}.repository'
import { ${pascal}Controller } from './${kebab}.controller'

// Eagerly load decorated classes so @Controller()/@Service()/@Repository() decorators
// register in the DI container. Recursive globs (./**/) so the module keeps working
// however you nest files (e.g. moving controllers into a controllers/ sub-folder).
import.meta.glob(
  ['./**/*.controller.ts', './**/*.service.ts', './**/*.repository.ts', '!./**/*.test.ts'],
  { eager: true },
)`

  const routesDoc = `    /**
     * Declare HTTP routes for this module. Return value shape:
     *
     *   - \`path\`        — URL prefix for this route set.
     *   - \`controller\`  — Controller class (also drives OpenAPI).
     *   - \`version\`     — Optional. Overrides the app-wide API version.
     *
     * Return an **array** to mount multiple route sets — admin
     * surfaces, side-by-side v1 + v2 controllers, etc:
     *
     *   return [
     *     { path: '/${plural}', version: 1, controller: ${pascal}V1Controller },
     *     { path: '/${plural}', version: 2, controller: ${pascal}V2Controller },
     *   ]
     */`

  if (resolvedStyle === 'class') {
    return `${header}
import { Container, type AppModule, type ModuleRoutes } from '@forinda/kickjs'
${repoImports}

export class ${pascal}Module implements AppModule {
  register(container: Container): void {
    container.registerFactory(${pascal.toUpperCase()}_REPOSITORY, () =>
      container.resolve(${repoClass}),
    )
  }

${routesDoc.replace(/^ {4}/gm, '  ').replace(/^ {6}/gm, '    ')}
  routes(): ModuleRoutes {
    return {
      path: '/${plural}',
      controller: ${pascal}Controller,
    }
  }
}
`
  }

  return `${header}
import { defineModule } from '@forinda/kickjs'
${repoImports}

export const ${pascal}Module = defineModule({
  name: '${pascal}Module',
  build: () => ({
    register(container) {
      container.registerFactory(${pascal.toUpperCase()}_REPOSITORY, () =>
        container.resolve(${repoClass}),
      )
    },

${routesDoc}
    routes() {
      return {
        path: '/${plural}',
        controller: ${pascal}Controller,
      }
    },
  }),
})
`
}

/** Minimal module index — just controller, no service/repo */
export function generateMinimalModuleIndex(ctx: TemplateContext): string {
  const { pascal, kebab, plural = '', style } = ctx
  const resolvedStyle = resolveStyle(style)

  const routesDoc = `    /**
     * Declare HTTP routes. Return value shape:
     *
     *   - \`path\`        — URL prefix for this route set.
     *   - \`controller\`  — Controller class (also drives OpenAPI).
     *   - \`version\`     — Optional. Overrides the app-wide API version.
     *
     * Return an array to mount multiple route sets:
     *
     *   return [
     *     { path: '/${plural}', version: 1, controller: ${pascal}V1Controller },
     *     { path: '/${plural}', version: 2, controller: ${pascal}V2Controller },
     *   ]
     */`

  if (resolvedStyle === 'class') {
    return `import { type AppModule, type ModuleRoutes } from '@forinda/kickjs'
import { ${pascal}Controller } from './${kebab}.controller'

export class ${pascal}Module implements AppModule {
${routesDoc.replace(/^ {4}/gm, '  ').replace(/^ {6}/gm, '    ')}
  routes(): ModuleRoutes {
    return {
      path: '/${plural}',
      controller: ${pascal}Controller,
    }
  }
}
`
  }

  return `import { defineModule } from '@forinda/kickjs'
import { ${pascal}Controller } from './${kebab}.controller'

export const ${pascal}Module = defineModule({
  name: '${pascal}Module',
  build: () => ({
${routesDoc}
    routes() {
      return {
        path: '/${plural}',
        controller: ${pascal}Controller,
      }
    },
  }),
})
`
}
