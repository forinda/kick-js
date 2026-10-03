/**
 * Resource providers: fixed resources and URI templates, served to 2025 and
 * 2026-07-28 clients, filtered per caller, scope-checked, and announced with
 * resources/list_changed.
 */
import 'reflect-metadata'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Application, Container, Controller, Get, type RequestContext } from '@forinda/kickjs'
import {
  MCP_ADAPTER,
  McpAdapter,
  type McpAdapterInstance,
  type McpAdapterOptions,
  type McpResourceProvider,
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
  class InvoiceController {
    @Get('/:id')
    get(ctx: RequestContext) {
      return { id: ctx.params.id, total: 42, auth: ctx.req.headers.authorization ?? null }
    }
  }
  return [{ routes: () => ({ path: '/invoices', controller: InvoiceController }) }] as never[]
}

const invoices: McpResourceProvider = {
  name: 'invoices',
  resources: [
    { uri: 'config://app', name: 'config', read: () => 'mode=test' },
    {
      uri: 'logo://png',
      name: 'logo',
      mimeType: 'image/png',
      read: () => new Uint8Array([1, 2, 3]),
    },
    { uri: 'ledger://all', name: 'ledger', scopes: ['ledger:read'], read: () => ({ rows: 1 }) },
  ],
  templates: [
    {
      uriTemplate: 'invoices://{id}',
      name: 'invoice',
      list: () => [{ uri: 'invoices://inv-1', name: 'Invoice inv-1' }],
      read: async ({ id }, ctx) => {
        const res = await ctx.fetch(
          new Request(new URL(`/api/v1/invoices/${id}`, ctx.origin), { headers: ctx.headers }),
        )
        return res.json()
      },
    },
  ],
}

async function start(extra: Partial<McpAdapterOptions> = {}) {
  const adapter = McpAdapter({ name: 'billing', path: '/mcp', ...extra })
  const app = new Application({ port: 0, modules: modules(), adapters: [adapter] } as never)
  await app.start()
  apps.push(app)
  const mcp = Container.getInstance().resolve(MCP_ADAPTER) as McpAdapterInstance
  mcp.registerResourceProvider(invoices)
  const { port } = (
    app as unknown as { httpServer: { address(): AddressInfo } }
  ).httpServer.address()
  return { port, mcp }
}

async function connect(
  port: number,
  mode: 'legacy' | { pin: string },
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

describe.each([
  ['2025-11-25', 'legacy' as const],
  ['2026-07-28', { pin: '2026-07-28' }],
])('resources over %s', (_label, mode) => {
  it('lists resources, template-listed resources and templates', async () => {
    const { port } = await start()
    const client = await connect(port, mode)
    expect((await client.listResources()).resources.map((r) => r.uri)).toEqual([
      'config://app',
      'logo://png',
      'ledger://all',
      'invoices://inv-1',
    ])
    expect((await client.listResourceTemplates()).resourceTemplates).toEqual([
      { uriTemplate: 'invoices://{id}', name: 'invoice' },
    ])
  })

  it('reads text, binary and template resources through the app', async () => {
    const { port } = await start()
    const client = await connect(port, mode, { authorization: 'Bearer abc' })
    expect((await client.readResource({ uri: 'config://app' })).contents).toEqual([
      { uri: 'config://app', mimeType: 'text/plain', text: 'mode=test' },
    ])
    expect((await client.readResource({ uri: 'logo://png' })).contents[0]).toMatchObject({
      mimeType: 'image/png',
      blob: Buffer.from([1, 2, 3]).toString('base64'),
    })
    const invoice = (await client.readResource({ uri: 'invoices://inv-7' })).contents[0]
    expect(invoice.mimeType).toBe('application/json')
    expect(JSON.parse((invoice as { text: string }).text)).toEqual({
      id: 'inv-7',
      total: 42,
      auth: 'Bearer abc',
    })
    await expect(client.readResource({ uri: 'nope://x' })).rejects.toThrow()
  })
})

describe('resource access', () => {
  it('hides filtered resources from lists and reads', async () => {
    const { port } = await start({
      resourceFilter: (resource) => resource.name !== 'config',
    })
    const client = await connect(port, { pin: '2026-07-28' })
    expect((await client.listResources()).resources.map((r) => r.uri)).not.toContain('config://app')
    await expect(client.readResource({ uri: 'config://app' })).rejects.toThrow()
  })

  it('filters each URI a template lists, not just the template', async () => {
    const { port } = await start({
      resourceFilter: (resource) => resource.uri !== 'invoices://inv-1',
    })
    const client = await connect(port, { pin: '2026-07-28' })
    expect((await client.listResources()).resources.map((r) => r.uri)).not.toContain(
      'invoices://inv-1',
    )
    expect((await client.listResourceTemplates()).resourceTemplates).toHaveLength(1)
  })

  it('answers 403 insufficient_scope for a resource the token lacks scopes for', async () => {
    const { port } = await start({
      stateless: true,
      auth: { type: 'bearer', authenticate: () => ({ subject: 'ada', scopes: [] }) },
    })
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer x',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'resources/read',
        params: { uri: 'ledger://all' },
      }),
    })
    expect(res.status).toBe(403)
    expect(res.headers.get('www-authenticate')).toContain('scope="ledger:read"')
  })

  it('notifies 2025 sessions when resources change', async () => {
    const { port, mcp } = await start()
    const client = await connect(port, 'legacy')
    let notified = 0
    client.setNotificationHandler('notifications/resources/list_changed', () => {
      notified++
    })
    // The notification rides the session's SSE stream, opened just after
    // connecting; re-mount until it has arrived.
    const more: McpResourceProvider = {
      name: 'more',
      resources: [{ uri: 'extra://1', name: 'extra', read: () => 'x' }],
    }
    await expect
      .poll(
        () => {
          if (notified === 0) mcp.registerResourceProvider(more)
          return notified
        },
        { interval: 50, timeout: 3000 },
      )
      .toBeGreaterThan(0)
    expect(() =>
      mcp.registerResourceProvider({
        name: 'dupe',
        resources: [{ uri: 'extra://1', name: 'dupe', read: () => 'y' }],
      }),
    ).toThrow(/already mounted/)
  })
})
