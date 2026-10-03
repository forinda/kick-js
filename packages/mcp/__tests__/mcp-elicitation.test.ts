/**
 * ctx.elicit: a custom tool asks the user mid-call. Works for 2026-07-28
 * clients (input_required rounds, answers carried in signed state) and for
 * 2025 sessions (the SDK sends real elicitation requests).
 */
import 'reflect-metadata'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { Application, Container } from '@forinda/kickjs'
import {
  MCP_ADAPTER,
  McpAdapter,
  type McpAdapterInstance,
  type McpToolProvider,
} from '@forinda/kickjs-mcp'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'

const apps: Application[] = []
const clients: Client[] = []
beforeEach(() => Container.reset())
afterEach(async () => {
  while (clients.length) await clients.pop()!.close()
  while (apps.length) await apps.pop()!.shutdown()
})

let runs = 0
const deploy: McpToolProvider = {
  name: 'deploy',
  tools: [
    {
      name: 'deploy',
      description: 'Deploy after confirming, with a note',
      inputSchema: z.object({ env: z.string() }),
      handler: async ({ env }: { env: string }, ctx) => {
        runs++
        const ok = await ctx.elicit<{ confirm: boolean }>('confirm', {
          message: `Deploy to ${env}?`,
          schema: z.object({ confirm: z.boolean() }),
        })
        if (!ok?.confirm) return 'cancelled'
        const note = await ctx.elicit<{ note: string }>('note', {
          message: 'Release note?',
          schema: z.object({ note: z.string() }),
        })
        return `deployed to ${env}: ${note?.note ?? '-'}`
      },
    },
  ],
}

async function start() {
  const adapter = McpAdapter({ name: 'ops', path: '/mcp' })
  const app = new Application({ port: 0, modules: [], adapters: [adapter] } as never)
  await app.start()
  apps.push(app)
  ;(Container.getInstance().resolve(MCP_ADAPTER) as McpAdapterInstance).registerProvider(deploy)
  const { port } = (
    app as unknown as { httpServer: { address(): AddressInfo } }
  ).httpServer.address()
  return port
}

async function connect(
  port: number,
  mode: 'legacy' | { pin: string },
  answer: (message: string) => { action: 'accept' | 'decline'; content?: Record<string, unknown> },
) {
  const client = new Client(
    { name: 'test', version: '1.0.0' },
    { versionNegotiation: { mode }, capabilities: { elicitation: { form: {} } } },
  )
  client.setRequestHandler('elicitation/create', async (request) =>
    answer((request.params as { message: string }).message),
  )
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)))
  clients.push(client)
  return client
}

const text = (result: { content: unknown }) => (result.content as Array<{ text: string }>)[0].text

describe.each([
  ['2025-11-25', 'legacy' as const],
  ['2026-07-28', { pin: '2026-07-28' }],
])('ctx.elicit over %s', (_label, mode) => {
  beforeEach(() => {
    runs = 0
  })

  it('asks in turn and keeps earlier answers', async () => {
    const port = await start()
    const asked: string[] = []
    const client = await connect(port, mode, (message) => {
      asked.push(message)
      return message.startsWith('Deploy')
        ? { action: 'accept', content: { confirm: true } }
        : { action: 'accept', content: { note: 'v2' } }
    })
    const result = await client.callTool({ name: 'deploy', arguments: { env: 'prod' } })
    expect(text(result)).toBe('deployed to prod: v2')
    expect(asked).toEqual(['Deploy to prod?', 'Release note?'])
    expect(runs).toBe(3)
  })

  it('returns undefined when the user declines', async () => {
    const port = await start()
    const client = await connect(port, mode, () => ({ action: 'decline' }))
    expect(text(await client.callTool({ name: 'deploy', arguments: { env: 'prod' } }))).toBe(
      'cancelled',
    )
  })
})
