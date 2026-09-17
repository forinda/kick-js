/**
 * The local custom provider from the AI guide ("Custom providers"), run for
 * real: a provider built only on the package's primitives, mounted with
 * `registerProvider`, driving an agent loop and a RAG index.
 *
 * Keep this file and the guide's example in sync.
 */
import 'reflect-metadata'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Application, Container, Controller, Get, type RequestContext } from '@forinda/kickjs'
import {
  AiAdapter,
  AiTool,
  InMemoryVectorStore,
  RagService,
  type AiProvider,
  type ChatChunk,
  type ChatInput,
  type ChatOptions,
  type ChatResponse,
  type EmbedInput,
} from '@forinda/kickjs-ai'

// ── The example provider ──────────────────────────────────────────────────

interface KeywordRule {
  /** When the latest user message matches, call this tool. */
  match: RegExp
  tool: string
  /** Build the tool arguments from the message. */
  args?: (message: string) => Record<string, unknown>
}

/**
 * A local, deterministic provider: routes a user message to a tool by
 * keyword, answers with the tool result, and embeds text with a hashed
 * bag-of-words vector. No network, no model — useful offline, in tests, or
 * as the starting point for wrapping an in-house model.
 */
class KeywordProvider implements AiProvider {
  readonly name = 'keywords'

  constructor(
    private readonly rules: KeywordRule[],
    private readonly dimensions = 64,
  ) {}

  async chat(input: ChatInput, options: ChatOptions = {}): Promise<ChatResponse> {
    options.signal?.throwIfAborted()
    const last = input.messages.at(-1)

    // A tool just ran: answer with its result and finish the loop.
    if (last?.role === 'tool') {
      return { content: `Here is what I found: ${last.content}`, finishReason: 'stop' }
    }

    const text = last?.content ?? ''
    // Only offer tools the caller made available on this call.
    const available = new Set((Array.isArray(input.tools) ? input.tools : []).map((t) => t.name))
    const rule = this.rules.find((r) => available.has(r.tool) && r.match.test(text))
    if (!rule) {
      return { content: "I don't have a tool for that.", finishReason: 'stop' }
    }
    return {
      content: '',
      toolCalls: [
        { id: `call_${crypto.randomUUID()}`, name: rule.tool, arguments: rule.args?.(text) ?? {} },
      ],
      finishReason: 'tool_call',
    }
  }

  async *stream(input: ChatInput, options: ChatOptions = {}): AsyncIterable<ChatChunk> {
    const response = await this.chat(input, options)
    if (response.content) yield { content: response.content, done: false }
    // Each tool call streams as a start delta, then one arguments delta.
    for (const [index, call] of (response.toolCalls ?? []).entries()) {
      yield { content: '', done: false, toolCallDelta: { id: call.id, index, name: call.name } }
      yield {
        content: '',
        done: false,
        toolCallDelta: { id: call.id, index, argumentsDelta: JSON.stringify(call.arguments) },
      }
    }
    yield { content: '', done: true, finishReason: response.finishReason }
  }

  async embed(input: EmbedInput): Promise<number[][]> {
    const texts = Array.isArray(input) ? input : [input]
    return texts.map((text) => {
      const vector = Array.from({ length: this.dimensions }, () => 0)
      for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
        let hash = 0
        for (const char of word) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
        vector[hash % this.dimensions] += 1
      }
      const length = Math.hypot(...vector) || 1
      return vector.map((value) => value / length)
    })
  }
}

// ── Using it ──────────────────────────────────────────────────────────────

const apps: Application[] = []
beforeEach(() => {
  Container.reset()
})
afterEach(async () => {
  while (apps.length) await apps.pop()!.shutdown()
})

async function startApp() {
  @Controller()
  class OrdersController {
    @Get('/:id')
    @AiTool({ name: 'get_order', description: 'Look up an order by id' })
    get(ctx: RequestContext) {
      ctx.json({ id: ctx.params.id, status: 'shipped' })
    }
  }

  const adapter = AiAdapter({ provider: new KeywordProvider([]) })
  const app = new Application({
    modules: [{ routes: () => ({ path: '/orders', controller: OrdersController }) }],
    adapters: [adapter],
  } as never)
  apps.push(app)
  await app.startWithoutServer()
  return adapter
}

describe('Example: a local custom provider', () => {
  it('drives an agent loop through a real route tool when mounted by name', async () => {
    const ai = await startApp()
    ai.registerProvider(
      'orders-bot',
      new KeywordProvider([
        {
          match: /order\s+#?(\w+)/i,
          tool: 'get_order',
          args: (message) => ({ id: /order\s+#?(\w+)/i.exec(message)![1] }),
        },
      ]),
    )

    const result = await ai.runAgent({
      provider: 'orders-bot',
      messages: [{ role: 'user', content: 'Where is order #A42?' }],
    })

    expect(result.content).toBe('Here is what I found: {"id":"A42","status":"shipped"}')
    expect(result.steps).toBe(2)
  })

  it('streams tool calls in the normalized chunk shape', async () => {
    const provider = new KeywordProvider([
      { match: /order/, tool: 'get_order', args: () => ({ id: '1' }) },
    ])
    const chunks: ChatChunk[] = []
    for await (const chunk of provider.stream({
      messages: [{ role: 'user', content: 'order please' }],
      tools: [{ name: 'get_order', description: '', inputSchema: {} }],
    })) {
      chunks.push(chunk)
    }
    expect(chunks.at(-1)).toEqual({ content: '', done: true, finishReason: 'tool_call' })
    expect(
      chunks.filter((c) => c.toolCallDelta).map((c) => c.toolCallDelta!.argumentsDelta),
    ).toEqual([undefined, '{"id":"1"}'])
  })

  it('powers a RAG index with local embeddings', async () => {
    const provider = new KeywordProvider([])
    const rag = new RagService(provider, new InMemoryVectorStore())
    await rag.index([
      { id: 'refunds', content: 'Refunds are issued within five business days' },
      { id: 'shipping', content: 'Orders ship from the Nairobi warehouse' },
    ])

    const [top] = await rag.search('when do refunds arrive', { topK: 1 })
    expect(top.id).toBe('refunds')
  })
})
