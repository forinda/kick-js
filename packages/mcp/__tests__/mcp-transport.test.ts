import 'reflect-metadata'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import express, { type Express } from 'express'
import request from 'supertest'
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
  @McpTool({ description: 'Create a new task' })
  create() {
    return { id: '1' }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

async function buildAdapterOnApp(): Promise<{ adapter: McpAdapter; app: Express }> {
  const app = express()
  app.use(express.json())

  const adapter = McpAdapter({
    name: 'test-server',
    version: '0.1.0',
    description: 'Test MCP server',
    mode: 'explicit',
    transport: 'http',
    basePath: '/_mcp',
  })

  adapter.onRouteMount(TaskController, '/api/v1/tasks')
  adapter.beforeStart({} as never)

  // Provide a minimal AdapterContext stub — only `app` is read by afterStart.
  await adapter.afterStart({ app, container: {} as never, server: undefined } as never)

  return { adapter, app }
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('McpAdapter — StreamableHTTP transport', () => {
  let active: McpAdapter | null = null

  beforeEach(() => {
    Container.reset()
    active = null
  })

  afterEach(async () => {
    if (active) await active.shutdown()
  })

  it('mounts the MCP endpoint at basePath/messages', async () => {
    const { adapter, app } = await buildAdapterOnApp()
    active = adapter

    // The MCP endpoint should accept POST and reply with JSON-RPC.
    // Without a proper `initialize` handshake the server returns an
    // error response, which is enough to prove the transport is mounted.
    const res = await request(app)
      .post('/_mcp/messages')
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      })

    // Status may be 200 (with a JSON-RPC error body) or 4xx for missing
    // session — both prove the transport is reachable. The key assertion
    // is that the route exists at all (not 404).
    expect(res.status).not.toBe(404)
  })

  it('reports the correct number of registered tools after afterStart', async () => {
    const { adapter } = await buildAdapterOnApp()
    active = adapter

    expect(adapter.getTools()).toHaveLength(1)
    expect(adapter.getTools()[0].name).toBe('TaskController.create')
  })

  it('accepts an OPTIONS preflight on the MCP endpoint', async () => {
    const { adapter, app } = await buildAdapterOnApp()
    active = adapter

    // Express auto-handles OPTIONS for routes that have GET/POST/DELETE
    // mounted. The adapter mounts all three, so OPTIONS should not 404.
    const res = await request(app).options('/_mcp/messages')
    expect(res.status).not.toBe(404)
  })

  it('cleanly shuts down the transport without throwing', async () => {
    const { adapter } = await buildAdapterOnApp()

    // First shutdown — should succeed
    await expect(adapter.shutdown()).resolves.toBeUndefined()

    // Second shutdown — should be idempotent (no throw)
    await expect(adapter.shutdown()).resolves.toBeUndefined()

    // Don't double-clean in afterEach
    active = null
  })

  it('skips Express mount when transport is stdio', async () => {
    const app = express()
    const adapter = McpAdapter({
      name: 'stdio-test',
      version: '0.1.0',
      transport: 'stdio',
    })

    adapter.onRouteMount(TaskController, '/api/v1/tasks')
    adapter.beforeStart({} as never)
    await adapter.afterStart({ app, container: {} as never, server: undefined } as never)
    active = adapter

    // No MCP endpoint should be registered
    const res = await request(app).post('/_mcp/messages').send({})
    expect(res.status).toBe(404)
  })
})
