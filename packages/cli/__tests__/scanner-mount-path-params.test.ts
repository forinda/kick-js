import { describe, expect, it } from 'vitest'
import {
  extractModuleMounts,
  extractRoutesFromSource,
  type DiscoveredClass,
} from '../src/typegen/scanner'

// forinda/kick-js#235 §3 — when a controller is mounted under a path with
// `:params` (e.g. `/orgs/:id/extensions`), the typegen scanner must
// surface those params in `pathParams` so `ctx.params.id` types
// without adopters re-declaring `params: schema` on every route.

const FAKE_CWD = '/repo'

function makeClass(
  name: string,
  filePath = '/repo/src/modules/ext/ext.controller.ts',
): DiscoveredClass {
  return {
    className: name,
    decorator: 'Controller',
    filePath,
    relativePath: filePath.slice(FAKE_CWD.length + 1),
    isDefault: false,
  }
}

describe('forinda/kick-js#235 §3 — extractModuleMounts', () => {
  it('extracts a single mount path + controller from a routes() return', () => {
    const source = `
      import { type AppModule, type ModuleRoutes, buildRoutes } from '@forinda/kickjs'
      import { ExtensionsController } from './extensions.controller'

      export class ExtensionsModule implements AppModule {
        routes(): ModuleRoutes {
          return {
            path: '/control/orgs/:id/extensions',
            router: buildRoutes(ExtensionsController),
            controller: ExtensionsController,
          }
        }
      }
    `
    const mounts = extractModuleMounts(source)
    expect(mounts).toEqual([
      { controller: 'ExtensionsController', mountPath: '/control/orgs/:id/extensions' },
    ])
  })

  it('extracts multiple mounts from an array-style routes() return', () => {
    const source = `
      export class MultiModule implements AppModule {
        routes() {
          return [
            { path: '/v1/orgs/:id', controller: OrgsV1Controller },
            { path: '/v2/orgs/:id', controller: OrgsV2Controller },
          ]
        }
      }
    `
    const mounts = extractModuleMounts(source)
    expect(mounts).toEqual([
      { controller: 'OrgsV1Controller', mountPath: '/v1/orgs/:id' },
      { controller: 'OrgsV2Controller', mountPath: '/v2/orgs/:id' },
    ])
  })

  it('returns empty when the source has no routes() body', () => {
    expect(extractModuleMounts(`export class NotAModule { foo() {} }`)).toEqual([])
  })
})

describe('forinda/kick-js#235 §3 — extractRoutesFromSource combines mount path with route path', () => {
  const controllerSource = `
    import { Controller, Get, Post, Delete } from '@forinda/kickjs'

    @Controller()
    export class ExtensionsController {
      @Get('/')
      async list(ctx) { ctx.params.id }

      @Post('/')
      async enable(ctx) { ctx.params.id }

      @Delete('/:code')
      async disable(ctx) { ctx.params.id; ctx.params.code }
    }
  `
  const cls = makeClass('ExtensionsController')

  it('without a mount-path map, pathParams is per-route only (legacy behaviour)', () => {
    const routes = extractRoutesFromSource(controllerSource, cls.filePath, FAKE_CWD, [cls])
    // Routes come back in source order: list → enable → disable. Only
    // the @Delete('/:code') route has a per-route param.
    const byMethod = new Map(routes.map((r) => [r.method, r.pathParams.toSorted()]))
    expect(byMethod.get('list')).toEqual([])
    expect(byMethod.get('enable')).toEqual([])
    expect(byMethod.get('disable')).toEqual(['code'])
  })

  it('with the mount-path map, pathParams surfaces `id` from the prefix on every route', () => {
    const mounts = new Map([['ExtensionsController', '/control/orgs/:id/extensions']])
    const routes = extractRoutesFromSource(controllerSource, cls.filePath, FAKE_CWD, [cls], mounts)
    const byMethod = new Map(routes.map((r) => [r.method, r.pathParams.toSorted()]))
    expect(byMethod.get('list')).toEqual(['id'])
    expect(byMethod.get('enable')).toEqual(['id'])
    // @Delete('/:code') — the prefix `:id` plus the per-route `:code`.
    expect(byMethod.get('disable')).toEqual(['code', 'id'])
  })

  it('mount path without params is a no-op — base case stays unaffected', () => {
    const mounts = new Map([['ExtensionsController', '/static-prefix']])
    const routes = extractRoutesFromSource(controllerSource, cls.filePath, FAKE_CWD, [cls], mounts)
    expect(routes.find((r) => r.method === 'list')?.pathParams).toEqual([])
    expect(routes.find((r) => r.method === 'disable')?.pathParams).toEqual(['code'])
  })
})
