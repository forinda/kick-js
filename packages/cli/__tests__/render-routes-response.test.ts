import { describe, it, expect } from 'vitest'
import { renderRoutes } from '../src/typegen/render/routes'
import type { DiscoveredRoute } from '../src/typegen/scanner'

/**
 * R2 (response-inference-design.md): `KickRoutes[...].response` is emitted as
 * a TYPE REFERENCE to the controller method — the consumer's tsc computes the
 * actual type via InferHandlerResponse. The scanner stays checker-free.
 */

function route(partial: Partial<DiscoveredRoute>): DiscoveredRoute {
  return {
    controller: 'UsersController',
    method: 'get',
    httpMethod: 'GET',
    path: '/:id',
    pathParams: ['id'],
    queryFilterable: null,
    querySortable: null,
    querySearchable: null,
    bodySchema: null,
    querySchema: null,
    paramsSchema: null,
    filePath: '/app/src/modules/users/users.controller.ts',
    relativePath: 'modules/users/users.controller.ts',
    mountedPath: '/users/:id',
    ...partial,
  }
}

const OUT = '/app/.kickjs/types/kick__routes.ts'

describe('renderRoutes — response inference emission', () => {
  it('emits an InferHandlerResponse reference + hoisted controller import', () => {
    const src = renderRoutes([route({})], OUT, 'zod')
    expect(src).toContain(
      "import type { UsersController as _C0 } from '../../src/modules/users/users.controller'",
    )
    expect(src).toContain("response: import('@forinda/kickjs').InferHandlerResponse<_C0['get']>")
  })

  it('reuses one alias per controller across multiple routes', () => {
    const src = renderRoutes(
      [route({}), route({ method: 'list', path: '/', pathParams: [] })],
      OUT,
      'zod',
    )
    expect(src.match(/import type \{ UsersController as _C0 \}/g)).toHaveLength(1)
    expect(src).toContain("InferHandlerResponse<_C0['get']>")
    expect(src).toContain("InferHandlerResponse<_C0['list']>")
  })

  it('uses a default-import binding for export-default controllers', () => {
    const src = renderRoutes([route({ controllerIsDefaultExport: true })], OUT, 'zod')
    expect(src).toContain(
      "import type { default as _C0 } from '../../src/modules/users/users.controller'",
    )
  })

  it('separate controllers in separate files get separate aliases', () => {
    const src = renderRoutes(
      [
        route({}),
        route({
          controller: 'TasksController',
          method: 'create',
          httpMethod: 'POST',
          filePath: '/app/src/modules/tasks/tasks.controller.ts',
          relativePath: 'modules/tasks/tasks.controller.ts',
        }),
      ],
      OUT,
      'zod',
    )
    expect(src).toContain('UsersController as _C0')
    expect(src).toContain('TasksController as _C1')
    expect(src).toContain("InferHandlerResponse<_C1['create']>")
  })
})

describe('renderRoutes — KickRoutes.Api flat map', () => {
  it('emits MOUNTED verb+path keys referencing the controller interfaces', () => {
    const src = renderRoutes(
      [
        route({}),
        route({
          method: 'create',
          httpMethod: 'POST',
          path: '/',
          pathParams: [],
          mountedPath: '/users',
        }),
      ],
      OUT,
      'zod',
    )
    expect(src).toContain("'GET /users/:id': UsersController['get']")
    expect(src).toContain("'POST /users': UsersController['create']")
    expect(src).toContain('interface Api {')
  })

  it('falls back to the bare path when mountedPath is absent (old fixtures)', () => {
    const src = renderRoutes([route({ mountedPath: undefined })], OUT, 'zod')
    expect(src).toContain("'GET /:id': UsersController['get']")
  })

  it('same decorator path under different mounts does NOT collide', () => {
    const warnings: string[] = []
    const src = renderRoutes(
      [
        route({}),
        route({
          controller: 'TasksController',
          method: 'get',
          filePath: '/app/src/modules/tasks/tasks.controller.ts',
          mountedPath: '/tasks/:id',
        }),
      ],
      OUT,
      'zod',
      { onWarn: (w) => warnings.push(w) },
    )
    expect(src).toContain("'GET /users/:id': UsersController['get']")
    expect(src).toContain("'GET /tasks/:id': TasksController['get']")
    expect(warnings).toEqual([])
  })

  it('empty routes still emit an (empty) KickRoutes.Api', () => {
    const src = renderRoutes([], OUT, 'zod')
    expect(src).toContain('interface Api {}')
  })

  it("warns when a controller is named 'Api' (reserved for the flat map)", () => {
    const warnings: string[] = []
    renderRoutes(
      [route({ controller: 'Api', filePath: '/app/src/api.controller.ts' })],
      OUT,
      'zod',
      { onWarn: (w) => warnings.push(w) },
    )
    expect(warnings.some((w) => w.includes('reserved KickRoutes.Api'))).toBe(true)
  })

  it('warns and keeps first on a REAL duplicate (same mounted verb+path)', () => {
    const warnings: string[] = []
    const src = renderRoutes(
      [
        route({}),
        route({
          controller: 'OtherController',
          method: 'also',
          filePath: '/app/src/other.controller.ts',
          mountedPath: '/users/:id',
        }),
      ],
      OUT,
      'zod',
      { onWarn: (w) => warnings.push(w) },
    )
    expect(src).toContain("'GET /users/:id': UsersController['get']")
    expect(src).not.toContain("OtherController['also']")
    expect(warnings.some((w) => w.includes('duplicate route'))).toBe(true)
  })
})
