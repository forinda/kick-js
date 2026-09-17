/**
 * The MCP endpoint and tool dispatch on every HTTP runtime, and without a
 * listening app server (createHandler): the endpoint speaks the web-standard
 * transport through `ctx.res`, and tool calls run through `AdapterContext.fetch`.
 */
import 'reflect-metadata'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  Application,
  Container,
  Controller,
  Put,
  createHandler,
  type KickHandler,
  type RequestContext,
} from '@forinda/kickjs'
import { fastifyRuntime } from '@forinda/kickjs/fastify'
import { h3WebRuntime } from '@forinda/kickjs/h3-web'
import * as h3v2 from 'h3-v2'
import { McpAdapter, McpTool } from '@forinda/kickjs-mcp'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const cleanups: Array<() => Promise<unknown>> = []

beforeEach(() => {
  Container.reset()
})
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!().catch(() => {})
})

function modules() {
  @Controller()
  class TaskController {
    @Put('/:id', { body: z.object({ title: z.string() }) })
    @McpTool({ description: 'Rename a task' })
    rename(ctx: RequestContext) {
      ctx.json({
        id: ctx.params.id,
        title: (ctx.body as { title: string }).title,
        tenant: ctx.headers['x-tenant'] ?? null,
        mcpTool: ctx.headers['x-mcp-tool'] ?? null,
      })
    }
  }
  return [{ routes: () => ({ path: '/tasks', controller: TaskController }) }] as never[]
}

const adapter = () =>
  McpAdapter({ name: 't', transport: 'http', forwardHeaders: ['authorization', 'x-tenant'] })

async function callRename(port: number) {
  const client = new Client({ name: 'test', version: '1.0.0' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/_mcp/messages`), {
      requestInit: { headers: { 'x-tenant': 'acme' } },
    }),
  )
  cleanups.push(() => client.close())
  const { tools } = await client.listTools()
  const result = await client.callTool({
    name: 'TaskController.rename',
    arguments: { id: '42', title: 'Ship' },
  })
  return { tools: tools.map((t) => t.name), result }
}

const runtimes = [
  ['express', undefined],
  ['fastify', () => fastifyRuntime()],
  ['h3 v2 (h3-web)', () => h3WebRuntime({ h3: h3v2 as never })],
] as const

describe('McpAdapter — runtimes', () => {
  it.each(runtimes)('serves the endpoint and dispatches tools on %s', async (_name, runtime) => {
    const app = new Application({
      port: 0,
      modules: modules(),
      adapters: [adapter()],
      ...(runtime ? { runtime: runtime() } : {}),
    } as never)
    await app.start()
    cleanups.push(() => app.shutdown())
    const { port } = (
      app as unknown as { httpServer: { address(): AddressInfo } }
    ).httpServer.address()

    const { tools, result } = await callRename(port)
    expect(tools).toEqual(['TaskController.rename'])
    expect(result.isError).toBe(false)
    expect(JSON.parse((result.content as Array<{ text: string }>)[0].text)).toEqual({
      id: '42',
      title: 'Ship',
      tenant: 'acme',
      mcpTool: 'TaskController.rename',
    })
  })
})

describe('McpAdapter — without a listening app server', () => {
  it('dispatches tools under createHandler, where afterStart never runs', async () => {
    const handler: KickHandler = createHandler({ modules: modules(), adapters: [adapter()] })
    cleanups.push(() => handler.close())
    const server = http.createServer((req, res) => void handler.node(req, res))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    cleanups.push(() => new Promise((resolve) => server.close(resolve)))

    const { result } = await callRename((server.address() as AddressInfo).port)
    expect(result.isError).toBe(false)
    expect(JSON.parse((result.content as Array<{ text: string }>)[0].text)).toMatchObject({
      id: '42',
      tenant: 'acme',
    })
  })
})
