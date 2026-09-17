/**
 * Custom tool providers: tools that are not controller routes, mounted with
 * `registerProvider` before or after clients connect.
 */
import 'reflect-metadata'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  Application,
  Container,
  Controller,
  Get,
  type AppModule,
  type RequestContext,
} from '@forinda/kickjs'
import { MCP_ADAPTER, McpAdapter, McpTool, type McpToolProvider } from '@forinda/kickjs-mcp'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'

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

function modules(): AppModule[] {
  @Controller()
  class StatsController {
    @Get('/')
    @McpTool({ description: 'Route tool' })
    stats(ctx: RequestContext) {
      ctx.json({ orders: 3, caller: ctx.headers.authorization ?? null })
    }
  }
  return [{ routes: () => ({ path: '/stats', controller: StatsController }) }] as never
}

const reports: McpToolProvider = {
  name: 'reports',
  tools: [
    {
      name: 'monthly_report',
      description: 'Monthly report',
      inputSchema: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }),
      handler: async ({ month }: { month: string }, ctx) => {
        const stats = await ctx.fetch(
          new Request('http://localhost/api/v1/stats', {
            headers: { authorization: ctx.headers.get('authorization') ?? '' },
          }),
        )
        return { month, stats: await stats.json() }
      },
    },
  ],
}

async function start(options: { plugins?: unknown[] } = {}) {
  const adapter = McpAdapter({ name: 't', transport: 'http' })
  const app = new Application({
    port: 0,
    modules: modules(),
    adapters: [adapter],
    plugins: options.plugins ?? [],
  } as never)
  await app.start()
  apps.push(app)
  const { port } = (
    app as unknown as { httpServer: { address(): AddressInfo } }
  ).httpServer.address()
  return { adapter, port }
}

async function connect(port: number) {
  const client = new Client({ name: 'test', version: '1.0.0' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/_mcp/messages`), {
      requestInit: { headers: { authorization: 'Bearer caller' } },
    }),
  )
  clients.push(client)
  return client
}

const text = (result: Awaited<ReturnType<Client['callTool']>>) =>
  (result.content as Array<{ text: string }>)[0].text

describe('McpAdapter — custom tool providers', () => {
  it('lists and calls provider tools next to route tools, validating arguments', async () => {
    const { adapter, port } = await start()
    adapter.registerProvider(reports)
    const client = await connect(port)

    const names = (await client.listTools()).tools.map((t) => t.name).toSorted()
    expect(names).toEqual(['StatsController.stats', 'monthly_report'])

    const ok = await client.callTool({ name: 'monthly_report', arguments: { month: '2026-09' } })
    expect(ok.isError).toBeFalsy()
    expect(JSON.parse(text(ok))).toEqual({
      month: '2026-09',
      stats: { orders: 3, caller: 'Bearer caller' },
    })

    const bad = await client.callTool({ name: 'monthly_report', arguments: { month: 'Sept' } })
    expect(bad.isError).toBe(true)
    expect(JSON.parse(text(bad)).error).toBe('Invalid arguments')
  })

  it('notifies connected clients when providers are mounted and unmounted', async () => {
    const { adapter, port } = await start()
    const client = await connect(port)
    let notified = 0
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
      notified++
    })

    // Notifications travel on the client's standalone SSE stream, which it
    // opens just after connecting; one sent before that is dropped (as the
    // spec allows). Re-mounting the same provider notifies again, so repeat
    // until the stream is open.
    await expect
      .poll(
        () => {
          if (notified === 0) adapter.registerProvider(reports)
          return notified
        },
        { interval: 50, timeout: 3000 },
      )
      .toBeGreaterThan(0)
    expect((await client.listTools()).tools.map((t) => t.name)).toContain('monthly_report')

    const beforeUnmount = notified
    expect(adapter.unregisterProvider('reports')).toBe(true)
    await expect.poll(() => notified).toBe(beforeUnmount + 1)
    expect((await client.listTools()).tools.map((t) => t.name)).not.toContain('monthly_report')
    expect(adapter.unregisterProvider('reports')).toBe(false)
  })

  it('passes MCP results through and reports handler errors as error results', async () => {
    const { adapter, port } = await start()
    adapter.registerProvider({
      name: 'misc',
      tools: [
        {
          name: 'native',
          description: 'Returns an MCP result',
          handler: () => ({ content: [{ type: 'text', text: 'as is' }] }),
        },
        {
          name: 'broken',
          description: 'Throws',
          handler: () => {
            throw new Error('report store offline')
          },
        },
      ],
    })
    const client = await connect(port)

    expect(text(await client.callTool({ name: 'native', arguments: {} }))).toBe('as is')
    const broken = await client.callTool({ name: 'broken', arguments: {} })
    expect(broken.isError).toBe(true)
    expect(text(broken)).toBe('report store offline')
  })

  it('rejects names used by routes or other providers, and replaces a provider by name', async () => {
    const { adapter, port } = await start()
    const tool = (name: string) => ({ name, description: name, handler: () => name })

    expect(() =>
      adapter.registerProvider({ name: 'a', tools: [tool('StatsController.stats')] }),
    ).toThrow(/already defined by a route/)
    expect(() => adapter.registerProvider({ name: 'a', tools: [tool('bad name')] })).toThrow(
      /must match/,
    )

    adapter.registerProvider({ name: 'a', tools: [tool('first')] })
    expect(() => adapter.registerProvider({ name: 'b', tools: [tool('first')] })).toThrow(
      /already defined by a/,
    )
    adapter.registerProvider({ name: 'a', tools: [tool('second')] })

    const client = await connect(port)
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toContain('second')
    expect(names).not.toContain('first')
  })

  it('is reachable from a plugin through the MCP_ADAPTER token', async () => {
    const { port } = await start({
      plugins: [
        {
          name: 'ReportsPlugin',
          onReady(container: Container) {
            container.resolve(MCP_ADAPTER).registerProvider(reports)
          },
        },
      ],
    })
    const client = await connect(port)
    expect((await client.listTools()).tools.map((t) => t.name)).toContain('monthly_report')
  })
})
