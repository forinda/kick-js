import path from 'node:path'

import { describe, it, expect, vi } from 'vitest'

import { renderRoutes } from '../src/typegen/render/routes'
import type { DiscoveredRoute } from '../src/typegen/scanner'

const OUT = path.resolve('.kickjs/types/kick__routes.ts')

const route = (overrides: Partial<DiscoveredRoute>): DiscoveredRoute => ({
  controller: 'TaskController',
  method: 'create',
  httpMethod: 'POST',
  path: '/',
  pathParams: [],
  queryFilterable: null,
  querySortable: null,
  querySearchable: null,
  bodySchema: null,
  querySchema: null,
  paramsSchema: null,
  filePath: path.resolve('src/modules/tasks/task.controller.ts'),
  relativePath: 'modules/tasks/task.controller.ts',
  ...overrides,
})

describe('renderRoutes fallback warnings', () => {
  it('warns when a wired body schema has an unresolvable source', () => {
    const onWarn = vi.fn()
    const src = renderRoutes(
      [route({ bodySchema: { identifier: 'createTaskSchema', source: null } })],
      OUT,
      'zod',
      { onWarn },
    )
    expect(src).toContain('body: unknown')
    expect(onWarn).toHaveBeenCalledTimes(1)
    expect(onWarn.mock.calls[0][0]).toContain('TaskController.create')
    expect(onWarn.mock.calls[0][0]).toContain('createTaskSchema')
  })

  it('query fallback warning names the @ApiQueryParams-derived shape when one exists', () => {
    const onWarn = vi.fn()
    renderRoutes(
      [
        route({
          querySchema: { identifier: 'listTasksQuery', source: null },
          queryFilterable: ['status'],
        }),
      ],
      OUT,
      'zod',
      { onWarn },
    )
    expect(onWarn).toHaveBeenCalledTimes(1)
    expect(onWarn.mock.calls[0][0]).toContain('@ApiQueryParams')
    expect(onWarn.mock.calls[0][0]).not.toContain("'unknown'")
  })

  it('does not warn when no schema is wired', () => {
    const onWarn = vi.fn()
    renderRoutes([route({})], OUT, 'zod', { onWarn })
    expect(onWarn).not.toHaveBeenCalled()
  })

  it('does not warn when the schema validator is disabled', () => {
    const onWarn = vi.fn()
    renderRoutes(
      [route({ bodySchema: { identifier: 'createTaskSchema', source: null } })],
      OUT,
      false,
      { onWarn },
    )
    expect(onWarn).not.toHaveBeenCalled()
  })

  it('does not warn when the schema resolves (same-file source)', () => {
    const onWarn = vi.fn()
    const src = renderRoutes(
      [route({ bodySchema: { identifier: 'createTaskSchema', source: '' } })],
      OUT,
      'zod',
      { onWarn },
    )
    expect(src).toContain('infer<typeof _S0>')
    expect(onWarn).not.toHaveBeenCalled()
  })
})
