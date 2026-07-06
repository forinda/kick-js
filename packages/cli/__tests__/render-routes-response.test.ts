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
