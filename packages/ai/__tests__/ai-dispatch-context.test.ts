/**
 * AiAdapter tool calls run through the app in-process (`AdapterContext.fetch`):
 * no listening server needed, caller headers reach the route, and the agent's
 * signal aborts in-flight calls.
 */
import 'reflect-metadata'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Application, Container, Controller, Get, type RequestContext } from '@forinda/kickjs'
import { AiAdapter, AiTool } from '@forinda/kickjs-ai'
import type { AiProvider, ChatInput, ChatResponse } from '@forinda/kickjs-ai'

class ScriptedProvider implements AiProvider {
  readonly name = 'scripted'
  readonly inputs: ChatInput[] = []
  constructor(private readonly queue: ChatResponse[]) {}
  async chat(input: ChatInput): Promise<ChatResponse> {
    this.inputs.push(structuredClone(input))
    const next = this.queue.shift()
    if (!next) throw new Error('no scripted response left')
    return next
  }
  // eslint-disable-next-line require-yield
  async *stream(): AsyncGenerator<never> {
    throw new Error('not used')
  }
  async embed(): Promise<number[][]> {
    throw new Error('not used')
  }
}

const apps: Application[] = []
beforeEach(() => {
  Container.reset()
})
afterEach(async () => {
  while (apps.length) await apps.pop()!.shutdown()
})

async function startWithoutServer(provider: AiProvider) {
  @Controller()
  class WhoAmIController {
    @Get('/')
    @AiTool({ description: 'Who is calling' })
    whoami(ctx: RequestContext) {
      ctx.json({ authorization: ctx.headers.authorization ?? null })
    }
  }
  const adapter = AiAdapter({ provider })
  const app = new Application({
    modules: [{ routes: () => ({ path: '/whoami', controller: WhoAmIController }) }],
    adapters: [adapter],
  } as never)
  apps.push(app)
  // No port, no afterStart — the createHandler() path.
  await app.startWithoutServer()
  return adapter
}

const script = (): ChatResponse[] => [
  {
    content: '',
    toolCalls: [{ id: 'call_1', name: 'WhoAmIController_whoami', arguments: {} }],
    finishReason: 'tool_calls',
  },
  { content: 'done', finishReason: 'stop' },
]

const toolResult = (provider: ScriptedProvider) =>
  provider.inputs[1].messages.find((m) => m.role === 'tool')!.content

describe('AiAdapter — in-process tool dispatch', () => {
  it('calls tools without a listening server and sends the caller headers', async () => {
    const provider = new ScriptedProvider(script())
    const adapter = await startWithoutServer(provider)

    const result = await adapter.runAgent({
      messages: [{ role: 'user', content: 'who am i' }],
      headers: { authorization: 'Bearer user-token' },
    })

    expect(result.content).toBe('done')
    expect(JSON.parse(toolResult(provider))).toEqual({ authorization: 'Bearer user-token' })
  })

  it('aborts tool calls with the agent signal', async () => {
    const provider = new ScriptedProvider(script())
    const adapter = await startWithoutServer(provider)

    await adapter.runAgent({
      messages: [{ role: 'user', content: 'who am i' }],
      signal: AbortSignal.abort(),
    })

    expect(JSON.parse(toolResult(provider)).error).toMatch(/Dispatch error: .*abort/i)
  })
})
