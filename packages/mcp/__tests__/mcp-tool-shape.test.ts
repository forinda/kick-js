/**
 * What clients are told about a tool: input schemas describe what the tool
 * accepts, examples reach tools/list, the HTTP method sets default
 * annotations, a 202 isn't passed off as a result, and transport errors carry
 * the SDK's codes.
 */
import 'reflect-metadata'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { Application, Container, Controller, Delete, Get, Post, reply } from '@forinda/kickjs'
import { McpAdapter, McpTool } from '@forinda/kickjs-mcp'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'

const apps: Application[] = []
beforeEach(() => Container.reset())
afterEach(async () => {
  while (apps.length) await apps.pop()!.shutdown()
})

@Controller()
class ItemController {
  @Get('/', { query: z.object({ limit: z.coerce.number().default(10) }) })
  @McpTool({ description: 'List items', examples: [{ args: { limit: 5 } }] })
  list() {
    return { items: [] }
  }

  @Delete('/:id')
  @McpTool({ description: 'Delete an item' })
  remove() {
    return { removed: true }
  }

  @Post('/', { body: z.object({ count: z.string().transform(Number) }) })
  @McpTool({ description: 'Create an item' })
  create() {
    return { created: true }
  }

  @Post('/jobs')
  @McpTool({ description: 'Start a job', outputSchema: z.object({ result: z.string() }) })
  job() {
    return reply(202, { ticket: 't-1' })
  }
}

async function start(extra: Partial<Parameters<typeof McpAdapter>[0]> = {}) {
  const adapter = McpAdapter({ name: 'items', path: '/mcp', ...extra })
  const app = new Application({
    port: 0,
    modules: [{ routes: () => ({ path: '/items', controller: ItemController }) }],
    adapters: [adapter],
  } as never)
  await app.start()
  apps.push(app)
  const { port } = (
    app as unknown as { httpServer: { address(): AddressInfo } }
  ).httpServer.address()
  return port
}

async function connect(port: number) {
  const client = new Client({ name: 't', version: '1' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)))
  return client
}

describe('McpAdapter — what tools/list says about a tool', () => {
  it('describes what the tool accepts, with its examples and method annotations', async () => {
    const client = await connect(await start({ stateless: true }))
    const { tools } = await client.listTools()
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]))

    const list = byName['ItemController.list']!
    // A defaulted, coerced query field is optional, and takes what's sent.
    expect(list.inputSchema.required ?? []).not.toContain('limit')
    expect((list.inputSchema as any).examples).toEqual([{ limit: 5 }])
    expect(list.annotations).toEqual({ readOnlyHint: true, idempotentHint: true })

    expect(byName['ItemController.remove']!.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    })
    // A transformed body field is described as what's sent: a string.
    const create = byName['ItemController.create']!.inputSchema as any
    expect(create.properties.body?.properties?.count ?? create.properties.count).toEqual({
      type: 'string',
    })
    await client.close()
  })

  it("says a 202 was accepted, and doesn't pass its body off as the result", async () => {
    const client = await connect(await start({ stateless: true }))
    // Listed first, so the client holds the tool's output schema.
    await client.listTools()
    const res = (await client.callTool({ name: 'ItemController.job', arguments: {} })) as any
    // It has an output schema, which a 202 can't meet: not a success.
    expect(res.isError).toBe(true)
    expect(res.structuredContent).toBeUndefined()
    expect(res.content[0].text).toMatch(/^Accepted \(202\)/)
    expect(res.content[0].text).toContain('"ticket":"t-1"')
    await client.close()
  })

  it('answers an unknown session with the SDK code, -32001', async () => {
    const port = await start()
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-session-id': 'nope',
        'mcp-protocol-version': '2025-06-18',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    })
    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe(-32001)
  })
})
