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

function repoLabel(repo: RepoType): string {
  return repoLabelMap[repo] ?? toPascalRepoType(repo)
}

/**
 * Class and file basename for the repository implementation.
 *
 * Only `inmemory` is special: it is the one built-in with a real working
 * implementation, and its name describes what it actually is.
 *
 * Everything else — including `drizzle` and `prisma`, which no longer have
 * dedicated generators — scaffolds the same unimplemented stub, so naming it
 * after the store would assert a technology the file does not implement. It
 * takes the module's name instead, which the folder already carries. The
 * chosen store still appears in the stub's prose and its error messages.
 */
/** The repository factory to call when registering the binding. */
function repoFactory(pascal: string): string {
  return `create${pascal}Repository`
}

/** Resolve the style flag, defaulting to 'define' for new code. */
function resolveStyle(style?: ModuleStyle): ModuleStyle {
  return style ?? 'define'
}

/** DDD module index — nested folders, use-cases, domain services */
export function generateModuleIndex(ctx: TemplateContext & { repo: RepoType }): string {
  const { pascal, kebab, plural = '', repo, style } = ctx
  const factory = repoFactory(pascal)
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
   * Currently wired to ${repoLabel(repo)}. To swap stores, write another
     * factory returning a compatible shape and call that one here — the
     * contract is the factory's return type, so nothing else changes.
   */
  register(container: Container): void {
    container.registerFactory(${pascal.toUpperCase()}_REPOSITORY, () => ${factory}())
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
     * Currently wired to ${repoLabel(repo)}. To swap stores, write another
     * factory returning a compatible shape and call that one here — the
     * contract is the factory's return type, so nothing else changes.
     */
    register(container) {
      container.registerFactory(${pascal.toUpperCase()}_REPOSITORY, () =>
        ${factory}(),
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
  const factory = repoFactory(pascal)
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
 *   ${kebab}.repository.ts  — Repository: factory, contract, token
 *   dtos/                   — Request/response schemas
 *
 * The repository is backed by an in-memory Map so this module works as
 * generated. Swap in ${repoLabel(repo)} by replacing the factory body in
 * ${kebab}.repository.ts — the contract is whatever that factory returns, so
 * nothing else has to change.
 */`

  const repoImports = `import { ${pascal.toUpperCase()}_REPOSITORY, ${factory} } from './${kebab}.repository'
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
    container.registerFactory(${pascal.toUpperCase()}_REPOSITORY, () => ${factory}())
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
        ${factory}(),
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
