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

describe('a schema declared in the controller file but not exported', () => {
  const controller = (exportKeyword: string) => `
import { Controller, Post, type RequestContext } from '@forinda/kickjs'
import { z } from 'zod'

${exportKeyword}const createTaskSchema = z.object({ title: z.string() })

@Controller()
export class TaskController {
  @Post('/', { body: createTaskSchema })
  create(ctx: RequestContext) {}
}
`

  it('is not imported (TS2459) — typegen says to export it instead', async () => {
    const { extractFile } = await import('../src/typegen/scanner')
    const file = path.resolve('src/modules/tasks/task.controller.ts')
    const [found] = extractFile(controller(''), file, process.cwd()).routes
    expect(found!.bodySchema).toEqual({
      identifier: 'createTaskSchema',
      source: null,
      unexported: true,
    })

    const onWarn = vi.fn()
    const src = renderRoutes([found!], OUT, 'zod', { onWarn })
    expect(src).not.toContain('createTaskSchema')
    expect(src).toContain('body: unknown')
    expect(onWarn.mock.calls[0][0]).toContain('but not exported')
    expect(onWarn.mock.calls[0][0]).toContain('export const createTaskSchema')
  })

  it('is imported once exported', async () => {
    const { extractFile } = await import('../src/typegen/scanner')
    const file = path.resolve('src/modules/tasks/task.controller.ts')
    for (const source of [
      controller('export '),
      `${controller('')}\nexport { createTaskSchema }\n`,
    ]) {
      const [found] = extractFile(source, file, process.cwd()).routes
      expect(found!.bodySchema).toEqual({ identifier: 'createTaskSchema', source: '' })
      expect(renderRoutes([found!], OUT, 'zod')).toContain(
        "import type { createTaskSchema as _S0 } from '../../src/modules/tasks/task.controller'",
      )
    }
  })
})
