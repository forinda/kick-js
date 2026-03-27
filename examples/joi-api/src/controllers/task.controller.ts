/**
 * Task Controller — demonstrates using Joi schemas with KickJS Swagger.
 *
 * Key differences from Zod-based controllers:
 *   1. Validation uses joiValidate() middleware instead of inline { body: schema }
 *   2. Swagger @ApiResponse uses Joi schemas (converted via joiSchemaParser)
 *   3. Same decorator pattern (@Controller, @Get, @Post, etc.)
 */
import { randomUUID } from 'node:crypto'
import { Controller, Get, Post, Put, Delete, Middleware } from '@forinda/kickjs-core'
import { RequestContext } from '@forinda/kickjs-http'
import { ApiTags, ApiOperation, ApiResponse } from '@forinda/kickjs-swagger'
import { joiValidate } from '../middleware/joi-validate'
import {
  createTaskSchema,
  updateTaskSchema,
  taskResponseSchema,
} from '../schemas/task.schema'

// In-memory store for demo purposes
const tasks = new Map<string, any>()

@Controller('/tasks')
@ApiTags('Tasks')
export class TaskController {
  @Post('/')
  @Middleware(joiValidate({ body: createTaskSchema }))
  @ApiOperation({
    summary: 'Create a task',
    description: 'Validates the request body with Joi. The Joi schema is '
      + 'automatically converted to OpenAPI JSON Schema via joiSchemaParser.',
  })
  @ApiResponse({ status: 201, description: 'Task created', schema: taskResponseSchema })
  @ApiResponse({ status: 422, description: 'Joi validation error' })
  async create(ctx: RequestContext) {
    const now = new Date().toISOString()
    const task = {
      id: randomUUID(),
      ...ctx.body,
      tags: ctx.body.tags ?? [],
      metadata: ctx.body.metadata ?? {},
      createdAt: now,
      updatedAt: now,
    }
    tasks.set(task.id, task)
    ctx.created(task)
  }

  @Get('/')
  @ApiOperation({ summary: 'List all tasks' })
  @ApiResponse({ status: 200, description: 'List of tasks' })
  async list(ctx: RequestContext) {
    ctx.json(Array.from(tasks.values()))
  }

  @Get('/:id')
  @ApiOperation({ summary: 'Get task by ID' })
  @ApiResponse({ status: 200, description: 'Task found', schema: taskResponseSchema })
  @ApiResponse({ status: 404, description: 'Task not found' })
  async getById(ctx: RequestContext) {
    const task = tasks.get(ctx.params.id)
    if (!task) return ctx.notFound('Task not found')
    ctx.json(task)
  }

  @Put('/:id')
  @Middleware(joiValidate({ body: updateTaskSchema }))
  @ApiOperation({
    summary: 'Update a task',
    description: 'Partial update with Joi validation. All fields are optional.',
  })
  @ApiResponse({ status: 200, description: 'Task updated', schema: taskResponseSchema })
  @ApiResponse({ status: 404, description: 'Task not found' })
  @ApiResponse({ status: 422, description: 'Joi validation error' })
  async update(ctx: RequestContext) {
    const task = tasks.get(ctx.params.id)
    if (!task) return ctx.notFound('Task not found')
    const updated = { ...task, ...ctx.body, updatedAt: new Date().toISOString() }
    tasks.set(ctx.params.id, updated)
    ctx.json(updated)
  }

  @Delete('/:id')
  @ApiOperation({ summary: 'Delete a task' })
  @ApiResponse({ status: 204, description: 'Task deleted' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  async remove(ctx: RequestContext) {
    if (!tasks.has(ctx.params.id)) return ctx.notFound('Task not found')
    tasks.delete(ctx.params.id)
    ctx.noContent()
  }
}
