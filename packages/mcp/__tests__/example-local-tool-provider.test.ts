/**
 * The local tool provider from the MCP guide ("Custom tool providers"), run
 * for real: tools that are not routes, built only on the package's
 * primitives, mounted from a plugin through MCP_ADAPTER.
 *
 * Keep this file and the guide's example in sync.
 */
import 'reflect-metadata'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { Application, Container } from '@forinda/kickjs'
import { MCP_ADAPTER, McpAdapter, type McpToolProvider } from '@forinda/kickjs-mcp'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

// ── The example provider ──────────────────────────────────────────────────

/** Team notes kept in memory: add, search, and check the app's health. */
function notesProvider(): McpToolProvider {
  const notes = new Map<string, { title: string; body: string }>()

  return {
    name: 'notes',
    tools: [
      {
        name: 'notes.add',
        description: 'Save a note with a title and a body. Returns the note id.',
        inputSchema: z.object({ title: z.string().min(1), body: z.string() }),
        handler: ({ title, body }: { title: string; body: string }) => {
          const id = crypto.randomUUID()
          notes.set(id, { title, body })
          return { id }
        },
      },
      {
        name: 'notes.search',
        description: 'Find notes whose title or body contains the query.',
        inputSchema: z.object({ query: z.string().min(1) }),
        handler: ({ query }: { query: string }) => {
          const needle = query.toLowerCase()
          return [...notes.entries()]
            .filter(([, n]) => `${n.title} ${n.body}`.toLowerCase().includes(needle))
            .map(([id, n]) => ({ id, title: n.title }))
        },
      },
      {
        name: 'app.health',
        description: "Report whether the app's dependencies are ready.",
        // ctx.fetch runs a request through the app's own pipeline — here the
        // built-in readiness probe — with the caller's cancellation.
        handler: async (_args: unknown, ctx) => {
          const res = await ctx.fetch(
            new Request('http://localhost/health/ready', { signal: ctx.signal }),
          )
          // Returning an MCP result sends it as is.
          return {
            content: [{ type: 'text', text: res.ok ? 'ready' : `not ready (${res.status})` }],
            isError: !res.ok,
          }
        },
      },
    ],
  }
}

// ── Using it ──────────────────────────────────────────────────────────────

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

describe('Example: a local tool provider', () => {
  it('mounts from a plugin and serves its tools to an MCP client', async () => {
    const app = new Application({
      port: 0,
      modules: [],
      adapters: [McpAdapter({ name: 'team-tools' })],
      plugins: [
        {
          name: 'NotesPlugin',
          onReady(container: Container) {
            container.resolve(MCP_ADAPTER).registerProvider(notesProvider())
          },
        },
      ],
    } as never)
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
    const text = (result: Awaited<ReturnType<Client['callTool']>>) =>
      (result.content as Array<{ text: string }>)[0].text

    expect((await client.listTools()).tools.map((t) => t.name).toSorted()).toEqual([
      'app.health',
      'notes.add',
      'notes.search',
    ])

    const added = await client.callTool({
      name: 'notes.add',
      arguments: { title: 'Deploy', body: 'Ship on Friday' },
    })
    const { id } = JSON.parse(text(added))

    const found = await client.callTool({ name: 'notes.search', arguments: { query: 'friday' } })
    expect(JSON.parse(text(found))).toEqual([{ id, title: 'Deploy' }])

    const invalid = await client.callTool({ name: 'notes.add', arguments: { title: '' } })
    expect(invalid.isError).toBe(true)

    expect(text(await client.callTool({ name: 'app.health', arguments: {} }))).toBe('ready')
  })
})
