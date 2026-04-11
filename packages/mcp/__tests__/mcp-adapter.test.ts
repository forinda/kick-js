import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import { z } from 'zod'
import { Container, Controller, Get, Post } from '@forinda/kickjs'
import { McpAdapter, McpTool } from '@forinda/kickjs-mcp'

// ── Fixtures ──────────────────────────────────────────────────────────────

const createTaskSchema = z.object({
  title: z.string(),
  priority: z.enum(['low', 'medium', 'high']),
})

@Controller()
class TaskController {
  @Get('/')
  list() {
    return []
  }

  @Post('/', { body: createTaskSchema, name: 'CreateTask' })
  @McpTool({ description: 'Create a new task with the given title and priority' })
  create() {
    return { id: '1' }
  }

  @Post('/internal', { name: 'InternalAction' })
  @McpTool({ description: 'Internal-only', hidden: true })
  internal() {
    return {}
  }
}

@Controller()
class HiddenController {
  @Get('/')
  list() {
    return []
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('McpAdapter — tool discovery', () => {
  beforeEach(() => Container.reset())

  it('discovers @McpTool-decorated methods in explicit mode', () => {
    const adapter = new McpAdapter({ name: 'test', mode: 'explicit' })

    adapter.onRouteMount(TaskController, '/api/v1/tasks')
    adapter.beforeStart({} as any)

    const tools = adapter.getTools()
    expect(tools).toHaveLength(1)
    expect(tools[0].name).toBe('TaskController.create')
    expect(tools[0].description).toBe('Create a new task with the given title and priority')
    expect(tools[0].httpMethod).toBe('POST')
    expect(tools[0].mountPath).toBe('/api/v1/tasks')
  })

  it('skips routes without @McpTool when mode is explicit', () => {
    const adapter = new McpAdapter({ name: 'test', mode: 'explicit' })

    adapter.onRouteMount(HiddenController, '/api/v1/hidden')
    adapter.beforeStart({} as any)

    expect(adapter.getTools()).toHaveLength(0)
  })

  it('honors hidden: true on @McpTool', () => {
    const adapter = new McpAdapter({ name: 'test', mode: 'explicit' })

    adapter.onRouteMount(TaskController, '/api/v1/tasks')
    adapter.beforeStart({} as any)

    const names = adapter.getTools().map((t) => t.name)
    expect(names).not.toContain('TaskController.internal')
  })

  it('exposes every route in auto mode and respects include filter', () => {
    const adapter = new McpAdapter({
      name: 'test',
      mode: 'auto',
      include: ['POST'],
    })

    adapter.onRouteMount(TaskController, '/api/v1/tasks')
    adapter.beforeStart({} as any)

    const tools = adapter.getTools()
    // create + internal are POST; internal is hidden, so 1 remains
    expect(tools).toHaveLength(1)
    expect(tools[0].httpMethod).toBe('POST')
  })

  it('respects exclude prefixes in auto mode', () => {
    const adapter = new McpAdapter({
      name: 'test',
      mode: 'auto',
      exclude: ['/api/v1/tasks'],
    })

    adapter.onRouteMount(TaskController, '/api/v1/tasks')
    adapter.beforeStart({} as any)

    expect(adapter.getTools()).toHaveLength(0)
  })

  it('converts the Zod body schema into a JSON Schema input', () => {
    const adapter = new McpAdapter({ name: 'test', mode: 'explicit' })

    adapter.onRouteMount(TaskController, '/api/v1/tasks')
    adapter.beforeStart({} as any)

    const tool = adapter.getTools().find((t) => t.name === 'TaskController.create')
    expect(tool).toBeDefined()
    expect(tool!.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        title: { type: 'string' },
        priority: expect.objectContaining({ enum: ['low', 'medium', 'high'] }),
      },
    })
  })

  it('falls back to an empty input schema when no Zod body is present', () => {
    @Controller()
    class NoBodyController {
      @Post('/', { name: 'NoBody' })
      @McpTool({ description: 'No body' })
      action() {}
    }

    const adapter = new McpAdapter({ name: 'test', mode: 'explicit' })
    adapter.onRouteMount(NoBodyController, '/api/v1/nobody')
    adapter.beforeStart({} as any)

    const tool = adapter.getTools().find((t) => t.name === 'NoBodyController.action')
    expect(tool).toBeDefined()
    expect(tool!.inputSchema).toMatchObject({
      type: 'object',
      properties: {},
      additionalProperties: false,
    })
  })
})
