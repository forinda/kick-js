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
const ENTRY = resolve('/proj/src/index.ts')

// App-level `contributors: [...]` applies to EVERY route, so unlike a
// module hook it needs no attribution — its keys union into all of them.
// Note the shape difference that drove the extractor change:
//
//   AppModule.contributors      -> (): ContributorRegistrations   (a hook)
//   ApplicationOptions.contributors ->  ContributorRegistrations  (an array)

const CONTRIBUTORS: DiscoveredContextKey[] = [
  {
    key: 'tenant',
    exportName: 'LoadTenant',
    filePath: resolve('/proj/src/contributors/tenant.ts'),
    relativePath: 'src/contributors/tenant.ts',
  },
  {
    key: 'startedAt',
    exportName: 'StartedAt',
    filePath: resolve('/proj/src/contributors/timing.ts'),
    relativePath: 'src/contributors/timing.ts',
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

function resolveWith(entrySrc: string, controllerSrc = CONTROLLER_SRC) {
  const controllerExtract = extractFile(controllerSrc, CONTROLLER, CWD)
  const entryExtract = extractFile(entrySrc, ENTRY, CWD)
  const extracts: (FileExtract | null)[] = [controllerExtract, entryExtract]
  const routes = controllerExtract.routes
  resolveRouteContextKeys(
    routes,
    CONTRIBUTORS,
    extracts.some((e) => e?.hasNonDecoratorContributors === true),
    buildModuleContributorMap(extracts),
    extracts.flatMap((e) => (e?.appContributors ? [e.appContributors] : [])),
  )
  return routes.map((r) => r.contextKeys)
}

describe('app-level contributors — recognised entry points', () => {
  it('resolves bootstrap({ contributors })', () => {
    expect(
      resolveWith(`
        import { bootstrap } from '@forinda/kickjs'
        import { LoadTenant } from './contributors/tenant'
        export const app = bootstrap({ modules: [], contributors: [LoadTenant.registration] })`),
    ).toEqual([['tenant']])
  })

  it('resolves new Application({ contributors })', () => {
    expect(
      resolveWith(`
        import { Application } from '@forinda/kickjs'
        import { LoadTenant } from './contributors/tenant'
        export const app = new Application({ modules: [], contributors: [LoadTenant.registration] })`),
    ).toEqual([['tenant']])
  })

  it('resolves createWebApp({ contributors })', () => {
    expect(
      resolveWith(`
        import { createWebApp } from '@forinda/kickjs/web'
        import { LoadTenant } from './contributors/tenant'
        export const app = createWebApp({ h3, modules: [], contributors: [LoadTenant.registration] })`),
    ).toEqual([['tenant']])
  })

  it('resolves the .with({...}).registration form', () => {
    expect(
      resolveWith(`
        import { bootstrap } from '@forinda/kickjs'
        import { LoadTenant } from './contributors/tenant'
        export const app = bootstrap({
          contributors: [LoadTenant.with({ source: 'header' }).registration],
        })`),
    ).toEqual([['tenant']])
  })

  it('unions app-level contributors with method decorators', () => {
    expect(
      resolveWith(
        `
        import { bootstrap } from '@forinda/kickjs'
        import { StartedAt } from './contributors/timing'
        export const app = bootstrap({ contributors: [StartedAt.registration] })`,
        `
        import { Controller, Get } from '@forinda/kickjs'
        import { LoadTenant } from '../contributors/tenant'
        @Controller()
        export class UserController {
          @LoadTenant
          @Get('/')
          list(ctx) {}
        }`,
      ),
    ).toEqual([['startedAt', 'tenant']])
  })

  it('applies to routes on controllers no module mounts', () => {
    // App-level contributors are global — attribution via mounts is
    // irrelevant, which is what distinguishes them from a module hook.
    expect(
      resolveWith(`
        import { bootstrap } from '@forinda/kickjs'
        import { LoadTenant } from './contributors/tenant'
        export const app = bootstrap({ contributors: [LoadTenant.registration] })`),
    ).toEqual([['tenant']])
  })

  it('an empty contributors array proves the empty set', () => {
    expect(
      resolveWith(`
        import { bootstrap } from '@forinda/kickjs'
        export const app = bootstrap({ modules: [], contributors: [] })`),
    ).toEqual([[]])
  })
})

describe('app-level contributors — degradation', () => {
  it('degrades when the array contains a spread', () => {
    expect(
      resolveWith(`
        import { bootstrap } from '@forinda/kickjs'
        import { LoadTenant } from './contributors/tenant'
        import { shared } from './shared'
        export const app = bootstrap({
          contributors: [LoadTenant.registration, ...shared],
        })`),
    ).toEqual([null])
  })

  it('degrades when contributors is a variable rather than a literal', () => {
    expect(
      resolveWith(`
        import { bootstrap } from '@forinda/kickjs'
        import { globalContributors } from './contributors'
        export const app = bootstrap({ contributors: globalContributors })`),
    ).toEqual([null])
  })

  it('degrades when an entry references an unresolvable binding', () => {
    expect(
      resolveWith(`
        import { bootstrap } from '@forinda/kickjs'
        export const app = bootstrap({ contributors: [Mystery.registration] })`),
    ).toEqual([null])
  })

  it('an adapter registration still degrades even alongside a resolvable bootstrap', () => {
    const controllerExtract = extractFile(CONTROLLER_SRC, CONTROLLER, CWD)
    const entryExtract = extractFile(
      `import { bootstrap } from '@forinda/kickjs'
       import { LoadTenant } from './contributors/tenant'
       export const app = bootstrap({ contributors: [LoadTenant.registration] })`,
      ENTRY,
      CWD,
    )
    const adapterExtract = extractFile(
      `import { defineAdapter } from '@forinda/kickjs'
       import { LoadTenant } from './contributors/tenant'
       export const a = defineAdapter({ name: 'x', build: () => ({ contributors: () => [LoadTenant.registration] }) })`,
      resolve('/proj/src/adapters/a.ts'),
      CWD,
    )
    const extracts: (FileExtract | null)[] = [controllerExtract, entryExtract, adapterExtract]
    const routes = controllerExtract.routes
    resolveRouteContextKeys(
      routes,
      CONTRIBUTORS,
      extracts.some((e) => e?.hasNonDecoratorContributors === true),
      buildModuleContributorMap(extracts),
      extracts.flatMap((e) => (e?.appContributors ? [e.appContributors] : [])),
    )
    expect(routes.map((r) => r.contextKeys)).toEqual([null])
  })

  it('does not treat a contributors option on an unrelated call as app-level', () => {
    // Only the three ApplicationOptions entry points count. Anything else
    // is an unknown registration site and must degrade.
    const extract = extractFile(
      `import { someOtherThing } from './x'
       import { LoadTenant } from './contributors/tenant'
       export const a = someOtherThing({ contributors: [LoadTenant.registration] })`,
      ENTRY,
      CWD,
    )
    expect(extract.appContributors).toBeNull()
    expect(extract.hasNonDecoratorContributors).toBe(true)
  })
})
