import 'reflect-metadata'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import http from 'node:http'
import express, { type Express } from 'express'
import { z } from 'zod'
import { Container, Controller, Get, Post, Delete } from '@forinda/kickjs'
import { McpAdapter, McpTool } from '@forinda/kickjs-mcp'

// ── Fixtures ──────────────────────────────────────────────────────────────

const createTaskSchema = z.object({
  title: z.string(),
  priority: z.enum(['low', 'medium', 'high']),
})

let createCalls: Array<unknown> = []
let lastDeleteId: string | null = null
let lastListQuery: unknown = null

@Controller()
class TaskController {
  @Get('/')
  list(req: any, res: any) {
    lastListQuery = req.query
    res.json([{ id: '1', title: 'Sample' }])
  }

  @Post('/', { body: createTaskSchema, name: 'CreateTask' })
  @McpTool({ description: 'Create a new task' })
  create(req: any, res: any) {
    createCalls.push(req.body)
    res.status(201).json({ id: 'created-1', ...req.body })
  }

  @Delete('/:id')
  @McpTool({ description: 'Delete a task by id' })
  remove(req: any, res: any) {
    if (req.params.id === 'missing') {
      res.status(404).json({ error: 'task not found' })
      return
    }
    lastDeleteId = req.params.id
    res.status(204).end()
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

interface ServerRig {
  adapter: McpAdapter
  app: Express
  server: http.Server
  port: number
}

/**
 * Spin up a real HTTP server with the TaskController mounted at
 * `/api/v1/tasks`, then attach an McpAdapter and run its lifecycle
 * hooks. Returns a rig the test can use to invoke tools and assert
 * the controller side-effects fired.
 */
async function startRig(): Promise<ServerRig> {
  const app = express()
  app.use(express.json())

  // Mount the controller's routes manually — we don't need the full
  // KickJS bootstrap for this test, just real HTTP routes the adapter
  // can dispatch against.
  app.get('/api/v1/tasks/', TaskController.prototype.list)
  app.post('/api/v1/tasks/', TaskController.prototype.create)
  app.delete('/api/v1/tasks/:id', TaskController.prototype.remove)

  const adapter = McpAdapter({
    name: 'dispatch-test',
    version: '0.1.0',
    mode: 'auto',
    transport: 'http',
    basePath: '/_mcp',
  })

  // Run the discovery scan against the controller class so the adapter
  // builds its tool definitions.
  adapter.onRouteMount(TaskController, '/api/v1/tasks')
  adapter.beforeStart({} as never)

  // Start the HTTP server on an ephemeral port so we have a real
  // server.address() for the dispatch loop to bind against.
  const server = await new Promise<http.Server>((resolve, reject) => {
    const s = http.createServer(app)
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => resolve(s))
  })

  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('no address')
  const port = address.port

  await adapter.afterStart({
    app,
    container: {} as never,
    server,
  } as never)

  return { adapter, app, server, port }
}

async function stopRig(rig: ServerRig): Promise<void> {
  await rig.adapter.shutdown()
  await new Promise<void>((resolve) => rig.server.close(() => resolve()))
}

/**
 * Reach into the adapter's private dispatch via the SDK by calling
 * the McpServer instance's tool callback. We don't go through the
 * MCP wire protocol here — we exercise the dispatch path directly,
 * which is what the SDK ultimately calls when a tool is invoked.
 */
async function callTool(
  adapter: McpAdapter,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  // The adapter's private dispatchTool method is where the real work
  // happens. Reach in via a typed cast so the test exercises the same
  // code path the MCP SDK calls when a client invokes a tool.
  const tool = adapter.getTools().find((t) => t.name === toolName)
  if (!tool) throw new Error(`tool ${toolName} not registered`)
  const dispatchFn = (adapter as unknown as {
    dispatchTool: (t: typeof tool, a: unknown) => Promise<any>
  }).dispatchTool.bind(adapter)
  return dispatchFn(tool, args)
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('McpAdapter — tool dispatch via internal HTTP', () => {
  let rig: ServerRig | null = null

  beforeEach(() => {
    Container.reset()
    createCalls = []
    lastDeleteId = null
    lastListQuery = null
    rig = null
  })

  afterEach(async () => {
    if (rig) await stopRig(rig)
  })

  it('dispatches a POST tool with body and returns the controller response', async () => {
    rig = await startRig()

    const result = await callTool(rig.adapter, 'TaskController.create', {
      title: 'Ship MCP',
      priority: 'high',
    })

    expect(result.isError).toBeFalsy()
    expect(createCalls).toHaveLength(1)
    expect(createCalls[0]).toEqual({ title: 'Ship MCP', priority: 'high' })

    // The controller responds with 201 + JSON; we should see the JSON
    // body as the tool result text.
    const text = result.content[0].text
    expect(text).toContain('"id":"created-1"')
    expect(text).toContain('"title":"Ship MCP"')
    expect(text).toContain('"priority":"high"')
  })

  it('substitutes path parameters from args before dispatch', async () => {
    rig = await startRig()

    const result = await callTool(rig.adapter, 'TaskController.remove', {
      id: 'task-42',
    })

    expect(result.isError).toBeFalsy()
    expect(lastDeleteId).toBe('task-42')
    // 204 No Content has empty body — placeholder text reflects the status
    expect(result.content[0].text).toMatch(/204|^$/)
  })

  it('serializes args as a query string for GET tools', async () => {
    rig = await startRig()

    const result = await callTool(rig.adapter, 'TaskController.list', {
      limit: 10,
      filter: 'open',
    })

    expect(result.isError).toBeFalsy()
    expect(lastListQuery).toMatchObject({
      limit: '10',
      filter: 'open',
    })
  })

  it('flags 4xx responses from the controller as errors in the tool result', async () => {
    rig = await startRig()

    // Controller returns 404 when id is "missing"
    const result = await callTool(rig.adapter, 'TaskController.remove', {
      id: 'missing',
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('task not found')
  })

  it('returns a transport error when serverBaseUrl was never captured', async () => {
    // No server passed in — adapter cannot resolve the base URL
    const app = express()
    const adapter = McpAdapter({
      name: 'no-server',
      version: '0.1.0',
      mode: 'auto',
      transport: 'http',
    })
    adapter.onRouteMount(TaskController, '/api/v1/tasks')
    adapter.beforeStart({} as never)
    await adapter.afterStart({ app, container: {} as never, server: undefined } as never)

    const result = await callTool(adapter, 'TaskController.create', {
      title: 'X',
      priority: 'low',
    })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/server address not yet captured/i)

    await adapter.shutdown()
  })
})
