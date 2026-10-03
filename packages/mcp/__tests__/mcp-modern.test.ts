/**
 * Protocol 2026-07-28 over HTTP: modern clients get stateless serving on the
 * same endpoint as 2025 clients with sessions, with the same auth, per-caller
 * tool lists and list-changed notifications.
 */
import 'reflect-metadata'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Application, Container, Controller, Get, type RequestContext } from '@forinda/kickjs'
import {
  MCP_ADAPTER,
  McpAdapter,
  McpTool,
  type McpAdapterInstance,
  type McpAdapterOptions,
} from '@forinda/kickjs-mcp'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'

const apps: Application[] = []
const clients: Client[] = []
beforeEach(() => Container.reset())
afterEach(async () => {
  while (clients.length) await clients.pop()!.close()
  while (apps.length) await apps.pop()!.shutdown()
})

function modules() {
  @Controller()
  class NotesController {
    @Get('/')
    @McpTool({ description: 'List notes' })
    list(ctx: RequestContext) {
      return { notes: ['a'], user: ctx.req.headers.authorization ?? null }
    }

    @Get('/admin')
    @McpTool({ description: 'Admin only' })
    admin() {
      return { ok: true }
    }
  }
  return [{ routes: () => ({ path: '/notes', controller: NotesController }) }] as never[]
}

async function start(extra: Partial<McpAdapterOptions> = {}) {
  const adapter = McpAdapter({ name: 'notes', path: '/mcp', ...extra })
  const app = new Application({ port: 0, modules: modules(), adapters: [adapter] } as never)
  await app.start()
  apps.push(app)
  const { port } = (
    app as unknown as { httpServer: { address(): AddressInfo } }
  ).httpServer.address()
  return { port, mcp: Container.getInstance().resolve(MCP_ADAPTER) as McpAdapterInstance }
}

async function connect(
  port: number,
  mode: 'legacy' | 'auto' | { pin: string },
  headers: Record<string, string> = {},
) {
  const client = new Client({ name: 'test', version: '1.0.0' }, { versionNegotiation: { mode } })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
      requestInit: { headers },
    }),
  )
  clients.push(client)
  return client
}

describe('protocol 2026-07-28', () => {
  it('serves a modern client and a 2025 client on one endpoint', async () => {
    const { port } = await start()

    const modern = await connect(port, { pin: '2026-07-28' })
    expect(modern.getNegotiatedProtocolVersion()).toBe('2026-07-28')
    const listed = await modern.listTools()
    expect(listed.tools.map((t) => t.name).toSorted()).toEqual([
      'NotesController.admin',
      'NotesController.list',
    ])
    const result = await modern.callTool({ name: 'NotesController.list', arguments: {} })
    expect(JSON.parse((result.content as Array<{ text: string }>)[0].text)).toMatchObject({
      notes: ['a'],
    })

    const legacy = await connect(port, 'legacy')
    expect(legacy.getNegotiatedProtocolVersion()).toBe('2025-11-25')
    expect((await legacy.listTools()).tools).toHaveLength(2)
  })

  it('negotiates 2026-07-28 in auto mode, also with stateless: true', async () => {
    const { port } = await start({ stateless: true })
    const client = await connect(port, 'auto')
    expect(client.getNegotiatedProtocolVersion()).toBe('2026-07-28')
    expect((await client.listTools()).tools).toHaveLength(2)
  })

  it('authenticates each request and filters tools per caller', async () => {
    const { port } = await start({
      auth: {
        type: 'bearer',
        authenticate: (token) => (token.startsWith('tok-') ? { subject: token.slice(4) } : null),
      },
      toolFilter: (tool, call) =>
        tool.name !== 'NotesController.admin' || call.principal?.subject === 'boss',
    })

    await expect(connect(port, { pin: '2026-07-28' })).rejects.toThrow()

    const ada = await connect(port, { pin: '2026-07-28' }, { authorization: 'Bearer tok-ada' })
    expect((await ada.listTools()).tools.map((t) => t.name)).toEqual(['NotesController.list'])
    await expect(ada.callTool({ name: 'NotesController.admin', arguments: {} })).rejects.toThrow(
      /Unknown tool/,
    )
    // The route sees the caller's credentials.
    const own = await ada.callTool({ name: 'NotesController.list', arguments: {} })
    expect((own.content as Array<{ text: string }>)[0].text).toContain('Bearer tok-ada')

    const boss = await connect(port, { pin: '2026-07-28' }, { authorization: 'Bearer tok-boss' })
    expect((await boss.listTools()).tools).toHaveLength(2)
  })

  it('tells a listening modern client when the tool list changes', async () => {
    const { port, mcp } = await start()
    const client = await connect(port, { pin: '2026-07-28' })
    let changed!: () => void
    const heard = new Promise<void>((resolve) => (changed = resolve))
    client.setNotificationHandler('notifications/tools/list_changed', () => changed())
    await client.listen({ toolsListChanged: true })

    mcp.registerProvider({
      name: 'extra',
      tools: [{ name: 'ping', description: 'Ping', handler: () => 'pong' }],
    })
    await heard
    expect((await client.listTools()).tools.map((t) => t.name)).toContain('ping')
  })
})
