/**
 * Phase A: a multi-tenant, per-user MCP surface — stateless serving, a custom
 * path, the caller's identity, per-caller tool lists, audience and scope
 * checks with OAuth challenges, protected-resource metadata, the tenant's
 * host on dispatch, allowed hosts, annotations, structured results, typed
 * tool errors and timeouts.
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
  Get,
  HttpException,
  defineRouteFlag,
  Post,
  type RequestContext,
} from '@forinda/kickjs'
import {
  MCP_ADAPTER,
  McpAdapter,
  McpTool,
  McpToolError,
  type McpAdapterInstance,
  type McpPrincipal,
  type McpToolOptions,
} from '@forinda/kickjs-mcp'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const apps: Application[] = []
beforeEach(() => Container.reset())
afterEach(async () => {
  while (apps.length) await apps.pop()!.shutdown()
})

function modules() {
  @Controller()
  class InvoiceController {
    @Get('/')
    @McpTool({
      description: 'List invoices',
      title: 'Invoices',
      annotations: { readOnlyHint: true },
      outputSchema: z.object({ host: z.string(), items: z.array(z.string()) }),
    })
    list(ctx: RequestContext) {
      // The tenant comes from the host, as in a host-per-tenant app.
      return { host: String(ctx.req.headers.host), items: ['inv-1'] }
    }

    @Post('/void')
    @McpTool({
      description: 'Void an invoice',
      annotations: { destructiveHint: true },
      scopes: ['invoices:write'],
    })
    void() {
      return { voided: true }
    }

    @Get('/missing')
    @McpTool({ description: 'Always 404' })
    missing() {
      throw HttpException.notFound('No such invoice')
    }
  }
  return [{ routes: () => ({ path: '/invoices', controller: InvoiceController }) }] as never[]
}

// Tokens: 'tok-<subject>-<aud host>-<scope,scope>'
function parseToken(token: string): McpPrincipal | null {
  const [, subject, audHost, scopes] = /^tok-([^-]+)-([^-]+)-?(.*)$/.exec(token) ?? []
  if (!subject) return null
  return {
    subject,
    audience: `http://${audHost}/mcp`,
    scopes: scopes ? scopes.split(',') : [],
  }
}

async function start(extra: Partial<Parameters<typeof McpAdapter>[0]> = {}) {
  const adapter = McpAdapter({
    name: 'billing',
    path: '/mcp',
    stateless: true,
    auth: { type: 'bearer', authenticate: (token) => parseToken(token) },
    protectedResource: {
      authorizationServers: (req) => [`https://auth.example.com/${req.host.split('.')[0]}`],
      scopesSupported: ['invoices:read', 'invoices:write'],
    },
    ...extra,
  })
  const app = new Application({ port: 0, modules: modules(), adapters: [adapter] } as never)
  await app.start()
  apps.push(app)
  const { port } = (
    app as unknown as { httpServer: { address(): AddressInfo } }
  ).httpServer.address()
  return { app, port, mcp: Container.getInstance().resolve(MCP_ADAPTER) as McpAdapterInstance }
}

/** A raw request with a chosen Host — fetch can't set one. */
function raw(
  port: number,
  opts: { host: string; method?: string; path?: string; token?: string; body?: unknown },
): Promise<{ status: number; headers: http.IncomingHttpHeaders; json: any }> {
  return new Promise((resolve, reject) => {
    const body = opts.body === undefined ? undefined : JSON.stringify(opts.body)
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: opts.method ?? 'POST',
        path: opts.path ?? '/mcp',
        headers: {
          host: opts.host,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
        },
      },
      (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => {
          let json: unknown
          try {
            json = data ? JSON.parse(data) : undefined
          } catch {
            json = data
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, json })
        })
      },
    )
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

const rpc = (method: string, params: unknown = {}, id = 1) => ({
  jsonrpc: '2.0',
  id,
  method,
  params,
})

describe('McpAdapter — multi-tenant surface', () => {
  it('serves statelessly at a custom path, through the SDK client', async () => {
    const { port } = await start()
    const client = new Client({ name: 't', version: '1' })
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
        requestInit: {
          headers: { authorization: 'Bearer tok-ada-127.0.0.1:' + port + '-invoices:read' },
        },
      }),
    )
    // Audience names this host; no session id is issued or needed.
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).toSorted()).toEqual([
      'InvoiceController.list',
      'InvoiceController.missing',
      'InvoiceController.void',
    ])
    await client.close()
    expect(
      (
        await raw(port, {
          host: `127.0.0.1:${port}`,
          method: 'GET',
          token: `tok-ada-127.0.0.1:${port}`,
        })
      ).status,
    ).toBe(405)
  })

  it('keeps the tenant host on dispatch, and returns structured content', async () => {
    const { port } = await start()
    const res = await raw(port, {
      host: 'acme.localhost',
      token: 'tok-ada-acme.localhost',
      body: rpc('tools/call', { name: 'InvoiceController.list', arguments: {} }),
    })
    expect(res.status).toBe(200)
    expect(res.json.result.structuredContent).toEqual({ host: 'acme.localhost', items: ['inv-1'] })
  })

  it('lists annotations, titles and output schemas', async () => {
    const { port } = await start()
    const res = await raw(port, {
      host: 'acme.localhost',
      token: 'tok-ada-acme.localhost',
      body: rpc('tools/list'),
    })
    const list = res.json.result.tools.find(
      (t: { name: string }) => t.name === 'InvoiceController.list',
    )
    expect(list).toMatchObject({ title: 'Invoices', annotations: { readOnlyHint: true } })
    expect(list.outputSchema).toMatchObject({ type: 'object' })
    const voidTool = res.json.result.tools.find(
      (t: { name: string }) => t.name === 'InvoiceController.void',
    )
    expect(voidTool.annotations).toEqual({ destructiveHint: true })
  })

  it('refuses a token minted for another tenant, with a resource_metadata challenge', async () => {
    const { port } = await start()
    const res = await raw(port, {
      host: 'acme.localhost',
      token: 'tok-ada-globex.localhost',
      body: rpc('tools/list'),
    })
    expect(res.status).toBe(401)
    expect(res.headers['www-authenticate']).toBe(
      'Bearer resource_metadata="http://acme.localhost/.well-known/oauth-protected-resource/mcp"',
    )
  })

  it('serves protected-resource metadata per host', async () => {
    const { port } = await start()
    const res = await raw(port, {
      host: 'acme.localhost',
      method: 'GET',
      path: '/.well-known/oauth-protected-resource/mcp',
    })
    expect(res.json).toEqual({
      resource: 'http://acme.localhost/mcp',
      authorization_servers: ['https://auth.example.com/acme'],
      scopes_supported: ['invoices:read', 'invoices:write'],
      bearer_methods_supported: ['header'],
    })
  })

  it('answers a call without the required scope with 403 insufficient_scope', async () => {
    const { port } = await start()
    const call = rpc('tools/call', { name: 'InvoiceController.void', arguments: {} })
    const denied = await raw(port, {
      host: 'acme.localhost',
      token: 'tok-ada-acme.localhost-invoices:read',
      body: call,
    })
    expect(denied.status).toBe(403)
    expect(denied.headers['www-authenticate']).toContain('error="insufficient_scope"')
    expect(denied.headers['www-authenticate']).toContain('scope="invoices:write"')
    const allowed = await raw(port, {
      host: 'acme.localhost',
      token: 'tok-ada-acme.localhost-invoices:write',
      body: call,
    })
    expect(allowed.json.result.isError).toBe(false)
  })

  it('filters the tool list per caller, and a hidden tool cannot be called', async () => {
    const { port } = await start({
      toolFilter: (tool, call) =>
        !tool.annotations?.destructiveHint || call.principal?.subject === 'boss',
    })
    const list = (token: string) =>
      raw(port, { host: 'acme.localhost', token, body: rpc('tools/list') }).then((r) =>
        r.json.result.tools.map((t: { name: string }) => t.name),
      )
    expect(await list('tok-ada-acme.localhost')).not.toContain('InvoiceController.void')
    expect(await list('tok-boss-acme.localhost')).toContain('InvoiceController.void')

    const guessed = await raw(port, {
      host: 'acme.localhost',
      token: 'tok-ada-acme.localhost-invoices:write',
      body: rpc('tools/call', { name: 'InvoiceController.void', arguments: {} }),
    })
    expect(guessed.json.error.code).toBe(-32602)
    expect(guessed.json.error.message).toContain('Unknown tool: InvoiceController.void')

    // Without the tool's scopes, a hidden tool still answers like an unknown
    // one, not with a 403 that names the scopes it needs.
    const unscoped = await raw(port, {
      host: 'acme.localhost',
      token: 'tok-ada-acme.localhost',
      body: rpc('tools/call', { name: 'InvoiceController.void', arguments: {} }),
    })
    expect(unscoped.status).toBe(200)
    expect(unscoped.json.error.code).toBe(-32602)
  })

  it('refuses hosts outside allowedHosts', async () => {
    const { port } = await start({ allowedHosts: (host) => host.endsWith('.localhost') })
    expect(
      (
        await raw(port, {
          host: 'evil.example.com',
          token: 'tok-ada-evil.example.com',
          body: rpc('tools/list'),
        })
      ).status,
    ).toBe(403)
  })

  it('returns an error route answer as structured Problem Details', async () => {
    const { port } = await start()
    const res = await raw(port, {
      host: 'acme.localhost',
      token: 'tok-ada-acme.localhost',
      body: rpc('tools/call', { name: 'InvoiceController.missing', arguments: {} }),
    })
    expect(res.json.result.isError).toBe(true)
    expect(res.json.result.structuredContent).toMatchObject({
      status: 404,
      detail: 'No such invoice',
    })
  })

  it('gives custom tools the principal and origin, typed errors and a timeout', async () => {
    const { port, mcp } = await start({ toolTimeoutMs: 100 })
    mcp.registerProvider({
      name: 'agent',
      tools: [
        {
          name: 'whoami',
          description: 'Who is calling',
          outputSchema: z.object({ subject: z.string(), origin: z.string() }),
          handler: (_args, ctx) => ({ subject: ctx.principal!.subject, origin: ctx.origin }),
        },
        {
          name: 'approve',
          description: 'Needs approval',
          handler: () => {
            throw new McpToolError('approval_pending', 'Waiting for a manager', {
              approvalId: 'ap-1',
            })
          },
        },
        { name: 'hang', description: 'Never ends', handler: () => new Promise(() => {}) },
      ],
    })
    const call = (name: string) =>
      raw(port, {
        host: 'acme.localhost',
        token: 'tok-ada-acme.localhost',
        body: rpc('tools/call', { name, arguments: {} }),
      }).then((r) => r.json.result)

    expect((await call('whoami')).structuredContent).toEqual({
      subject: 'ada',
      origin: 'http://acme.localhost',
    })
    expect(await call('approve')).toMatchObject({
      isError: true,
      structuredContent: {
        error: { code: 'approval_pending', message: 'Waiting for a manager', approvalId: 'ap-1' },
      },
    })
    expect(await call('hang')).toMatchObject({
      isError: true,
      structuredContent: { error: { code: 'timeout' } },
    })
  })

  it('takes annotations, scopes and titles from a route flag, without @McpTool', async () => {
    const Tool = defineRouteFlag<Partial<McpToolOptions>>('mcp.tool')
    @Controller()
    class PaymentController {
      @Post('/refund')
      @Tool({
        description: 'Refund a payment',
        title: 'Refund',
        annotations: { destructiveHint: true },
        scopes: ['payments:write'],
      })
      refund() {
        return { refunded: true }
      }
    }
    const adapter = McpAdapter({ name: 'pay', exposeWhen: 'mcp.tool' })
    const app = new Application({
      port: 0,
      modules: [{ routes: () => ({ path: '/payments', controller: PaymentController }) }],
      adapters: [adapter],
    } as never)
    await app.start()
    apps.push(app)
    expect(adapter.getTools()).toEqual([
      expect.objectContaining({
        name: 'PaymentController.refund',
        title: 'Refund',
        annotations: { destructiveHint: true },
        scopes: ['payments:write'],
      }),
    ])
  })
})
