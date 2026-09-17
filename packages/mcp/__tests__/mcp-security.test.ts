/**
 * MCP endpoint access control and sessions, through a real Application and
 * the MCP SDK client: per-client sessions, `auth`, `Origin` checks, and
 * `exclude` matching full route paths.
 */
import 'reflect-metadata'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { Application, Container, Controller, Get, Post, type RequestContext } from '@forinda/kickjs'
import { McpAdapter, McpTool } from '@forinda/kickjs-mcp'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { matchesPathPattern } from '../src/mcp.adapter'

const apps: Application[] = []
const clients: Client[] = []

beforeEach(() => {
  Container.reset()
})
afterEach(async () => {
  while (clients.length)
    await clients
      .pop()!
      .close()
      .catch(() => {})
  while (apps.length) await apps.pop()!.shutdown()
})

function modulesFor() {
  @Controller()
  class TaskController {
    @Get('/')
    @McpTool({ description: 'List tasks' })
    list(ctx: RequestContext) {
      ctx.json([{ id: '1' }])
    }

    @Post('/', { body: z.object({ title: z.string() }) })
    @McpTool({ description: 'Create a task' })
    create(ctx: RequestContext) {
      ctx.json({ created: ctx.body }, 201)
    }
  }

  @Controller()
  class AdminController {
    @Get('/')
    root(ctx: RequestContext) {
      ctx.json({ ok: true })
    }

    @Get('/users')
    users(ctx: RequestContext) {
      ctx.json([])
    }
  }

  return [
    { routes: () => ({ path: '/tasks', controller: TaskController }) },
    { routes: () => ({ path: '/admin', controller: AdminController }) },
  ] as never[]
}

async function start(adapter: ReturnType<typeof McpAdapter>) {
  const app = new Application({ port: 0, modules: modulesFor(), adapters: [adapter] } as never)
  await app.start()
  apps.push(app)
  const { port } = (
    app as unknown as { httpServer: { address(): AddressInfo } }
  ).httpServer.address()
  return { app, endpoint: new URL(`http://127.0.0.1:${port}/_mcp/messages`) }
}

async function connect(endpoint: URL, headers?: Record<string, string>) {
  const client = new Client({ name: 'test-client', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(endpoint, { requestInit: { headers } }))
  clients.push(client)
  return client
}

const initializeBody = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'raw', version: '1' },
  },
})

const post = (endpoint: URL, headers: Record<string, string> = {}, body = initializeBody) =>
  fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body,
  })

describe('McpAdapter — sessions', () => {
  it('serves several clients at once, each with its own session', async () => {
    const { endpoint } = await start(McpAdapter({ name: 't', transport: 'http' }))
    const first = await connect(endpoint)
    const second = await connect(endpoint)

    const [a, b] = await Promise.all([first.listTools(), second.listTools()])
    expect(a.tools.map((t) => t.name).toSorted()).toEqual([
      'TaskController.create',
      'TaskController.list',
    ])
    expect(b.tools).toHaveLength(2)

    const result = await second.callTool({ name: 'TaskController.list', arguments: {} })
    expect(result.isError).toBe(false)
  })

  it('answers 404 for an unknown session and 400 for a non-initialize request without one', async () => {
    const { endpoint } = await start(McpAdapter({ name: 't', transport: 'http' }))

    const unknown = await post(endpoint, { 'mcp-session-id': 'not-a-session' })
    expect(unknown.status).toBe(404)

    const noSession = await post(
      endpoint,
      {},
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    )
    expect(noSession.status).toBe(400)
  })

  it('does not register tools twice when the same adapter instance starts again', async () => {
    const adapter = McpAdapter({ name: 't', transport: 'http' })
    const { app } = await start(adapter)
    expect(adapter.getTools()).toHaveLength(2)

    await app.shutdown()
    apps.pop()
    Container.reset()
    const { endpoint } = await start(adapter)

    expect(adapter.getTools()).toHaveLength(2)
    const client = await connect(endpoint)
    expect((await client.listTools()).tools).toHaveLength(2)
  })
})

describe('McpAdapter — session limits', () => {
  it('answers 503 to a new client beyond maxSessions', async () => {
    const { endpoint } = await start(McpAdapter({ name: 't', transport: 'http', maxSessions: 1 }))
    expect((await post(endpoint)).status).toBe(200)
    expect((await post(endpoint)).status).toBe(503)
  })

  it('closes a session left idle past sessionIdleTimeoutMs', async () => {
    const { endpoint } = await start(
      McpAdapter({ name: 't', transport: 'http', sessionIdleTimeoutMs: 50 }),
    )
    const init = await post(endpoint)
    const sessionId = init.headers.get('mcp-session-id')!
    await init.text()

    await new Promise((resolve) => setTimeout(resolve, 200))
    const later = await post(
      endpoint,
      { 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-06-18' },
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    )
    expect(later.status).toBe(404)
  })

  it('keeps a connected client with an open notification stream past the idle timeout', async () => {
    const { endpoint } = await start(
      McpAdapter({ name: 't', transport: 'http', sessionIdleTimeoutMs: 300 }),
    )
    const client = await connect(endpoint)
    await new Promise((resolve) => setTimeout(resolve, 700))
    expect((await client.listTools()).tools).toHaveLength(2)
  })
})

describe('McpAdapter — auth', () => {
  it('rejects requests without a valid bearer token, before a session exists', async () => {
    const validate = vi.fn((token: string) => token === 'secret')
    const { endpoint } = await start(
      McpAdapter({ name: 't', transport: 'http', auth: { type: 'bearer', validate } }),
    )

    const missing = await post(endpoint)
    expect(missing.status).toBe(401)
    expect(missing.headers.get('www-authenticate')).toBe('Bearer')
    expect(validate).not.toHaveBeenCalled()

    const wrong = await post(endpoint, { authorization: 'Bearer nope' })
    expect(wrong.status).toBe(401)
    expect(validate).toHaveBeenCalledWith('nope')

    await expect(connect(endpoint)).rejects.toThrow()
  })

  it('checks the token on every request, including tool calls in an open session', async () => {
    let valid = true
    const { endpoint } = await start(
      McpAdapter({
        name: 't',
        transport: 'http',
        auth: { type: 'bearer', validate: (token) => valid && token === 'secret' },
      }),
    )
    const client = await connect(endpoint, { authorization: 'Bearer secret' })
    expect((await client.listTools()).tools).toHaveLength(2)

    valid = false
    await expect(client.listTools()).rejects.toThrow()
  })

  it('custom auth receives the raw Authorization header, and a throw rejects', async () => {
    const validate = vi.fn((header: string) => {
      if (header === 'boom') throw new Error('store down')
      return header === 'ApiKey k1'
    })
    const { endpoint } = await start(
      McpAdapter({ name: 't', transport: 'http', auth: { type: 'custom', validate } }),
    )

    expect((await post(endpoint)).status).toBe(401)
    expect(validate).toHaveBeenCalledWith('')
    expect((await post(endpoint, { authorization: 'boom' })).status).toBe(401)
    expect((await post(endpoint, { authorization: 'ApiKey k1' })).status).toBe(200)
  })
})

describe('McpAdapter — Origin', () => {
  it('rejects browser origins by default and accepts clients that send none', async () => {
    const { endpoint } = await start(McpAdapter({ name: 't', transport: 'http' }))

    const evil = await post(endpoint, { origin: 'https://evil.example' })
    expect(evil.status).toBe(403)

    expect((await post(endpoint)).status).toBe(200)
  })

  it('accepts origins listed in allowedOrigins', async () => {
    const { endpoint } = await start(
      McpAdapter({ name: 't', transport: 'http', allowedOrigins: ['https://inspector.example'] }),
    )
    expect((await post(endpoint, { origin: 'https://inspector.example' })).status).toBe(200)
    expect((await post(endpoint, { origin: 'https://other.example' })).status).toBe(403)
  })
})

describe('McpAdapter — exclude', () => {
  it('matches the full route path, including the api prefix, in auto mode', async () => {
    const adapter = McpAdapter({
      name: 't',
      transport: 'http',
      mode: 'auto',
      exclude: ['/admin/*'],
    })
    await start(adapter)
    const paths = adapter.getTools().map((t) => t.mountPath)
    expect(paths.some((p) => p.includes('/admin'))).toBe(false)
    expect(paths.some((p) => p.includes('/tasks'))).toBe(true)
  })

  it.each([
    ['/api/v1/admin/users', '/admin/*', true],
    ['/api/v1/admin', '/admin/*', true],
    ['/api/v1/administrators', '/admin/*', false],
    ['/api/v1/admin/users', '/admin', true],
    ['/api/v1/tasks/:id', '/tasks/*/archive', false],
    ['/api/v1/tasks/:id/archive', '/tasks/*/archive', true],
    ['/api/v1/tasks', '/api/v1/tasks', true],
    ['/api/v1/tasks', '/users', false],
  ])('%s against %s -> %s', (path, pattern, expected) => {
    expect(matchesPathPattern(path, pattern)).toBe(expected)
  })
})
