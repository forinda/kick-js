import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'

import {
  buildModuleContributorMap,
  extractFile,
  resolveRouteContextKeys,
} from '../src/typegen/scanner'
import type { DiscoveredContextKey, FileExtract } from '../src/typegen/scanner'

const CWD = resolve('/proj')
const CONTROLLER = resolve('/proj/src/users/user.controller.ts')
const MODULE = resolve('/proj/src/users/user.module.ts')

// Module-level `contributors()` used to degrade the ENTIRE project: the
// scanner detected the word `contributors` and gave up everywhere. It's
// now attributed to the controllers that module mounts, so a module-scoped
// contributor narrows like a class-level decorator does.
//
// Adapter / plugin / bootstrap registrations still degrade — they apply
// app-wide and can't be tied to any particular route. The classifier that
// separates the two is `AppModule`'s own shape: `contributors()` and
// `routes()` are declared as siblings, so a `contributors` member next to
// a `routes` member is the module hook and nothing else is.

const CONTRIBUTORS: DiscoveredContextKey[] = [
  {
    key: 'tenant',
    exportName: 'LoadTenant',
    filePath: resolve('/proj/src/contributors/tenant.ts'),
    relativePath: 'src/contributors/tenant.ts',
  },
  {
    key: 'audit',
    exportName: 'Audit',
    filePath: resolve('/proj/src/contributors/audit.ts'),
    relativePath: 'src/contributors/audit.ts',
  },
]

const CONTROLLER_SRC = `
import { Controller, Get } from '@forinda/kickjs'
@Controller()
export class UserController {
  @Get('/')
  list(ctx) {}
}
`

/** Extract a controller + module pair and resolve the routes' keys. */
function resolveWith(moduleSrc: string, controllerSrc = CONTROLLER_SRC) {
  const controllerExtract = extractFile(controllerSrc, CONTROLLER, CWD)
  const moduleExtract = extractFile(moduleSrc, MODULE, CWD)
  const extracts: (FileExtract | null)[] = [controllerExtract, moduleExtract]
  const routes = controllerExtract.routes
  resolveRouteContextKeys(
    routes,
    CONTRIBUTORS,
    extracts.some((e) => e?.hasNonDecoratorContributors === true),
    buildModuleContributorMap(extracts),
  )
  return routes.map((r) => r.contextKeys)
}

describe('module-level contributors() — defineModule object form', () => {
  it('attributes the module hook to the controllers it mounts', () => {
    expect(
      resolveWith(`
        import { defineModule } from '@forinda/kickjs'
        import { UserController } from './user.controller'
        import { LoadTenant } from '../contributors/tenant'
        export const UserModule = defineModule({
          name: 'Users',
          build: () => ({
            routes: () => ({ path: '/users', controller: UserController }),
            contributors: () => [LoadTenant.registration],
          }),
        })`),
    ).toEqual([['tenant']])
  })

  it('resolves the .with({...}).registration form', () => {
    expect(
      resolveWith(`
        import { defineModule } from '@forinda/kickjs'
        import { UserController } from './user.controller'
        import { LoadTenant } from '../contributors/tenant'
        export const UserModule = defineModule({
          name: 'Users',
          build: () => ({
            routes: () => ({ path: '/users', controller: UserController }),
            contributors: () => [LoadTenant.with({ source: 'subdomain' }).registration],
          }),
        })`),
    ).toEqual([['tenant']])
  })

  it('unions several module contributors', () => {
    expect(
      resolveWith(`
        import { defineModule } from '@forinda/kickjs'
        import { UserController } from './user.controller'
        import { LoadTenant } from '../contributors/tenant'
        import { Audit } from '../contributors/audit'
        export const UserModule = defineModule({
          name: 'Users',
          build: () => ({
            routes: () => ({ path: '/users', controller: UserController }),
            contributors: () => [LoadTenant.registration, Audit.registration],
          }),
        })`),
    ).toEqual([['audit', 'tenant']])
  })

  it('unions module contributors with method-level decorators', () => {
    // Precedence (method > class > module) decides which registration wins
    // for a duplicate key, not whether the key is present — so the route's
    // provable set is the union.
    expect(
      resolveWith(
        `
        import { defineModule } from '@forinda/kickjs'
        import { UserController } from './user.controller'
        import { LoadTenant } from '../contributors/tenant'
        export const UserModule = defineModule({
          name: 'Users',
          build: () => ({
            routes: () => ({ path: '/users', controller: UserController }),
            contributors: () => [LoadTenant.registration],
          }),
        })`,
        `
        import { Controller, Get } from '@forinda/kickjs'
        import { Audit } from '../contributors/audit'
        @Controller()
        export class UserController {
          @Audit
          @Get('/')
          list(ctx) {}
        }`,
      ),
    ).toEqual([['audit', 'tenant']])
  })

  it('resolves module imports against the MODULE file, not the controller', () => {
    // The module and the controllers it mounts routinely live in different
    // directories; resolving the hook's relative specifiers against the
    // controller would silently fail to match.
    expect(
      resolveWith(`
        import { defineModule } from '@forinda/kickjs'
        import { UserController } from './user.controller'
        import { LoadTenant } from '@/contributors/tenant'
        export const UserModule = defineModule({
          name: 'Users',
          build: () => ({
            routes: () => ({ path: '/users', controller: UserController }),
            contributors: () => [LoadTenant.registration],
          }),
        })`),
    ).toEqual([['tenant']])
  })
})

describe('module-level contributors() — class form', () => {
  it('attributes an AppModule class hook to its mounted controllers', () => {
    expect(
      resolveWith(`
        import type { AppModule } from '@forinda/kickjs'
        import { UserController } from './user.controller'
        import { LoadTenant } from '../contributors/tenant'
        export class UserModule implements AppModule {
          routes() {
            return [{ path: '/users', controller: UserController }]
          }
          contributors() {
            return [LoadTenant.registration]
          }
        }`),
    ).toEqual([['tenant']])
  })
})

describe('module contributors — degradation', () => {
  it('degrades when the hook contains something it cannot enumerate', () => {
    expect(
      resolveWith(`
        import { defineModule } from '@forinda/kickjs'
        import { UserController } from './user.controller'
        import { buildContributors } from './helpers'
        export const UserModule = defineModule({
          name: 'Users',
          build: () => ({
            routes: () => ({ path: '/users', controller: UserController }),
            contributors: () => buildContributors(),
          }),
        })`),
    ).toEqual([null])
  })

  it('degrades on a spread inside the hook', () => {
    expect(
      resolveWith(`
        import { defineModule } from '@forinda/kickjs'
        import { UserController } from './user.controller'
        import { LoadTenant } from '../contributors/tenant'
        import { shared } from './shared'
        export const UserModule = defineModule({
          name: 'Users',
          build: () => ({
            routes: () => ({ path: '/users', controller: UserController }),
            contributors: () => [LoadTenant.registration, ...shared],
          }),
        })`),
    ).toEqual([null])
  })

  it('degrades when the hook references an unresolvable binding', () => {
    expect(
      resolveWith(`
        import { defineModule } from '@forinda/kickjs'
        import { UserController } from './user.controller'
        export const UserModule = defineModule({
          name: 'Users',
          build: () => ({
            routes: () => ({ path: '/users', controller: UserController }),
            contributors: () => [Mystery.registration],
          }),
        })`),
    ).toEqual([null])
  })

  it('still degrades the whole project for a bootstrap-level registration', () => {
    // `bootstrap({ contributors })` has no sibling `routes`, so it is not
    // classified as a module hook and keeps forcing degradation.
    const controllerExtract = extractFile(CONTROLLER_SRC, CONTROLLER, CWD)
    const bootstrapExtract = extractFile(
      `import { bootstrap } from '@forinda/kickjs'
       import { LoadTenant } from './contributors/tenant'
       export const app = bootstrap({ modules: [], contributors: [LoadTenant.registration] })`,
      resolve('/proj/src/index.ts'),
      CWD,
    )
    expect(bootstrapExtract.hasNonDecoratorContributors).toBe(true)

    const extracts: (FileExtract | null)[] = [controllerExtract, bootstrapExtract]
    const routes = controllerExtract.routes
    resolveRouteContextKeys(routes, CONTRIBUTORS, true, buildModuleContributorMap(extracts))
    expect(routes.map((r) => r.contextKeys)).toEqual([null])
  })

  it('classifies an adapter contributors() hook as app-wide', () => {
    // `defineAdapter({ contributors })` — no sibling `routes`.
    const extract = extractFile(
      `import { defineAdapter } from '@forinda/kickjs'
       import { LoadTenant } from './contributors/tenant'
       export const a = defineAdapter({
         name: 'x',
         contributors: () => [LoadTenant.registration],
       })`,
      resolve('/proj/src/adapters/a.ts'),
      CWD,
    )
    expect(extract.hasNonDecoratorContributors).toBe(true)
    expect(extract.moduleContributors).toBeNull()
  })

  it('does not flag a module file that has no contributors hook', () => {
    const extract = extractFile(
      `import { defineModule } from '@forinda/kickjs'
       import { UserController } from './user.controller'
       export const UserModule = defineModule({
         name: 'Users',
         build: () => ({ routes: () => ({ path: '/users', controller: UserController }) }),
       })`,
      MODULE,
      CWD,
    )
    expect(extract.hasNonDecoratorContributors).toBe(false)
    expect(extract.moduleContributors).toBeNull()
  })

  it('degrades a controller mounted by two modules', () => {
    // Which module's contributors applied depends on which mount served
    // the request, so neither set can be asserted.
    const controllerExtract = extractFile(CONTROLLER_SRC, CONTROLLER, CWD)
    const moduleSrc = (name: string) => `
      import { defineModule } from '@forinda/kickjs'
      import { UserController } from './user.controller'
      import { LoadTenant } from '../contributors/tenant'
      export const ${name} = defineModule({
        name: '${name}',
        build: () => ({
          routes: () => ({ path: '/${name}', controller: UserController }),
          contributors: () => [LoadTenant.registration],
        }),
      })`
    const extracts: (FileExtract | null)[] = [
      controllerExtract,
      extractFile(moduleSrc('A'), resolve('/proj/src/users/a.module.ts'), CWD),
      extractFile(moduleSrc('B'), resolve('/proj/src/users/b.module.ts'), CWD),
    ]
    const routes = controllerExtract.routes
    resolveRouteContextKeys(routes, CONTRIBUTORS, false, buildModuleContributorMap(extracts))
    expect(routes.map((r) => r.contextKeys)).toEqual([null])
  })
})
