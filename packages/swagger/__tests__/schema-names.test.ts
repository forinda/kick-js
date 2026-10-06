/** Component names: explicit name > the schema's title > <Class><Method><Part>. */
import 'reflect-metadata'
import { beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  ApiResponse,
  buildOpenAPISpec,
  clearRegisteredRoutes,
  registerControllerForDocs,
} from '@forinda/kickjs-swagger'
import { Controller, Get, Post } from '@forinda/kickjs'

beforeEach(() => clearRegisteredRoutes())

const names = (spec: any) => Object.keys(spec.components?.schemas ?? {}).toSorted()

describe('component names', () => {
  it('default to <Class><Method><Part>', () => {
    @Controller()
    class TaskController {
      @Post('/', { body: z.object({ title: z.string() }), response: z.object({ id: z.string() }) })
      @ApiResponse({ status: 409, description: 'Taken', schema: z.object({ reason: z.string() }) })
      create() {}
    }
    registerControllerForDocs(TaskController, '/tasks')
    expect(names(buildOpenAPISpec())).toEqual([
      'TaskControllerCreateBody',
      'TaskControllerCreateResponse409',
    ])
  })

  it("use the schema's title over the default", () => {
    @Controller()
    class TaskController {
      @Post('/', { body: z.object({ title: z.string() }).meta({ title: 'NewTask' }) })
      create() {}
    }
    registerControllerForDocs(TaskController, '/tasks')
    expect(names(buildOpenAPISpec())).toEqual(['NewTask'])
  })

  it("prefix the route's parts with its name, and take @ApiResponse's name as it is", () => {
    @Controller()
    class TaskController {
      @Post('/', {
        name: 'CreateTask',
        body: z.object({ title: z.string() }).meta({ title: 'Ignored' }),
        response: z.object({ id: z.string() }),
      })
      create() {}

      @Get('/:id')
      @ApiResponse({
        status: 200,
        description: 'OK',
        name: 'Task',
        schema: z.object({ id: z.string() }),
      })
      get() {}
    }
    registerControllerForDocs(TaskController, '/tasks')
    expect(names(buildOpenAPISpec())).toEqual(['CreateTaskBody', 'CreateTaskResponse', 'Task'])
  })
})
