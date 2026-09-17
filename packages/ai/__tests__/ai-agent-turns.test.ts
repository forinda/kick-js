/**
 * runAgent turn handling: provider-native content (thinking blocks) goes back
 * with the tool calls it led to, refused or truncated turns never run their
 * tool calls, and failed tool calls are marked as errors.
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

let calls: string[] = []
const apps: Application[] = []

beforeEach(() => {
  Container.reset()
  calls = []
})
afterEach(async () => {
  while (apps.length) await apps.pop()!.shutdown()
})

async function start(provider: AiProvider) {
  @Controller()
  class ToolsController {
    @Get('/ok')
    @AiTool({ description: 'Works' })
    ok(ctx: RequestContext) {
      calls.push('ok')
      ctx.json({ ok: true })
    }

    @Get('/broken')
    @AiTool({ description: 'Fails' })
    broken(ctx: RequestContext) {
      calls.push('broken')
      ctx.json({ message: 'boom' }, 500)
    }
  }
  const adapter = AiAdapter({ provider })
  const app = new Application({
    modules: [{ routes: () => ({ path: '/tools', controller: ToolsController }) }],
    adapters: [adapter],
  } as never)
  apps.push(app)
  await app.startWithoutServer()
  return adapter
}

const thinking = [{ type: 'thinking', thinking: '', signature: 'sig' }]

describe('runAgent — turns', () => {
  it('sends provider content back with the tool calls, and marks failed calls as errors', async () => {
    const provider = new ScriptedProvider([
      {
        content: '',
        toolCalls: [
          { id: 'c1', name: 'ToolsController_ok', arguments: {} },
          { id: 'c2', name: 'ToolsController_broken', arguments: {} },
        ],
        finishReason: 'tool_call',
        providerContent: thinking,
      },
      { content: 'done', finishReason: 'stop' },
    ])
    const adapter = await start(provider)

    await adapter.runAgent({ messages: [{ role: 'user', content: 'go' }] })

    const second = provider.inputs[1].messages
    expect(second[1]).toMatchObject({ role: 'assistant', providerContent: thinking })
    expect(second.slice(2)).toEqual([
      { role: 'tool', toolCallId: 'c1', content: '{"ok":true}' },
      expect.objectContaining({ role: 'tool', toolCallId: 'c2', isError: true }),
    ])
  })

  it.each([
    ['length', undefined],
    ['content_filter', { category: 'cyber', explanation: 'Declined.' }],
  ])('does not run tool calls from a turn that stopped with %s', async (finishReason, refusal) => {
    const provider = new ScriptedProvider([
      {
        content: '',
        toolCalls: [{ id: 'c1', name: 'ToolsController_ok', arguments: {} }],
        finishReason,
        ...(refusal ? { refusal } : {}),
      },
    ])
    const adapter = await start(provider)

    const result = await adapter.runAgent({ messages: [{ role: 'user', content: 'go' }] })

    expect(calls).toEqual([])
    expect(result.steps).toBe(1)
    expect(result.finishReason).toBe(finishReason)
    expect(result.refusal).toEqual(refusal)
  })
})
