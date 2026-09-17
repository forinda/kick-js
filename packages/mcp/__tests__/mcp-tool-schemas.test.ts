/**
 * Tool input schemas and argument mapping through a real Application and
 * the MCP SDK client: path parameters, query/body split, non-Zod schemas,
 * duplicate names.
 */
import 'reflect-metadata'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  Application,
  Container,
  Controller,
  Delete,
  Get,
  Post,
  Put,
  type RequestContext,
} from '@forinda/kickjs'
import { McpAdapter, McpTool } from '@forinda/kickjs-mcp'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const apps: Application[] = []
const clients: Client[] = []

beforeEach(() => {
  Container.reset()
})
afterEach(async () => {
  while (clients.length) {
    await clients
      .pop()!
      .close()
      .catch(() => {})
  }
  while (apps.length) await apps.pop()!.shutdown()
})

/** A Standard Schema (no Zod) that publishes its JSON Schema. */
const standardTitle = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (value: unknown) =>
      typeof (value as { title?: unknown })?.title === 'string'
        ? { value }
        : { issues: [{ message: 'title must be a string', path: [{ key: 'title' }] }] },
    jsonSchema: {
      input: () => ({
        type: 'object',
        properties: { title: { type: 'string' } },
        required: ['title'],
      }),
    },
  },
}

function modules() {
  @Controller()
  class TaskController {
    @Put('/:id', { body: z.object({ title: z.string() }) })
    @McpTool({ description: 'Rename a task' })
    rename(ctx: RequestContext) {
      ctx.json({ id: ctx.params.id, body: ctx.body })
    }

    @Delete('/:id')
    @McpTool({ description: 'Delete a task' })
    remove(ctx: RequestContext) {
      ctx.json({ deleted: ctx.params.id })
    }

    @Get('/', { query: z.object({ status: z.string().optional() }) })
    @McpTool({ description: 'List tasks' })
    list(ctx: RequestContext) {
      ctx.json({ query: ctx.query })
    }

    @Post('/', { body: standardTitle })
    @McpTool({ description: 'Create a task', name: 'create_task' })
    create(ctx: RequestContext) {
      ctx.json({ created: ctx.body }, 201)
    }
  }

  @Controller()
  class OtherController {
    @Post('/')
    @McpTool({ description: 'Clashes with TaskController.create', name: 'create_task' })
    create(ctx: RequestContext) {
      ctx.json({ other: true })
    }
  }

  return [
    { routes: () => ({ path: '/tasks', controller: TaskController }) },
    { routes: () => ({ path: '/other', controller: OtherController }) },
  ] as never[]
}

async function connect() {
  const adapter = McpAdapter({ name: 't', transport: 'http' })
  const app = new Application({ port: 0, modules: modules(), adapters: [adapter] } as never)
  await app.start()
  apps.push(app)
  const { port } = (
    app as unknown as { httpServer: { address(): AddressInfo } }
  ).httpServer.address()
  const client = new Client({ name: 'test', version: '1.0.0' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/_mcp/messages`)),
  )
  clients.push(client)
  return { client, adapter }
}

const textOf = (result: Awaited<ReturnType<Client['callTool']>>) =>
  JSON.parse((result.content as Array<{ text: string }>)[0].text)

describe('McpAdapter — tool input schemas', () => {
  it('lists path parameters next to body fields, all required', async () => {
    const { client } = await connect()
    const { tools } = await client.listTools()
    const rename = tools.find((t) => t.name === 'TaskController.rename')!
    expect(Object.keys(rename.inputSchema.properties ?? {}).toSorted()).toEqual(['id', 'title'])
    expect([...(rename.inputSchema.required ?? [])].toSorted()).toEqual(['id', 'title'])
  })

  it('fills the path parameter instead of calling /tasks/:id', async () => {
    const { client } = await connect()
    const result = await client.callTool({
      name: 'TaskController.rename',
      arguments: { id: '42', title: 'Ship' },
    })
    expect(result.isError).toBe(false)
    expect(textOf(result)).toEqual({ id: '42', body: { title: 'Ship' } })
  })

  it('reports a missing path parameter as a tool error', async () => {
    const { client } = await connect()
    const result = await client.callTool({ name: 'TaskController.remove', arguments: {} })
    expect(result.isError).toBe(true)
    expect((result.content as Array<{ text: string }>)[0].text).toContain(
      'Missing path parameter "id"',
    )
  })

  it('sends GET arguments as the query string', async () => {
    const { client } = await connect()
    const result = await client.callTool({
      name: 'TaskController.list',
      arguments: { status: 'open' },
    })
    expect(textOf(result)).toEqual({ query: { status: 'open' } })
  })

  it('exposes and calls a tool whose body is a non-Zod Standard Schema', async () => {
    const { client } = await connect()
    const { tools } = await client.listTools()
    const create = tools.find((t) => t.name === 'create_task')!
    expect(create.inputSchema.properties).toEqual({ title: { type: 'string' } })

    const result = await client.callTool({ name: 'create_task', arguments: { title: 'x' } })
    expect(result.isError).toBe(false)
    expect(textOf(result)).toEqual({ created: { title: 'x' } })
  })

  it('skips a duplicate tool name and keeps every other tool working', async () => {
    const { client, adapter } = await connect()
    const names = adapter.getTools().map((t) => t.name)
    expect(names.filter((n) => n === 'create_task')).toHaveLength(1)
    expect(names).toContain('TaskController.rename')

    const result = await client.callTool({ name: 'create_task', arguments: { title: 'y' } })
    expect(textOf(result)).toEqual({ created: { title: 'y' } })
  })
})
