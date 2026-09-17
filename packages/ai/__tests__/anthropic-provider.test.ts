/**
 * AnthropicProvider on the official SDK. The SDK runs for real against a fake
 * `fetch` that serves Messages API SSE streams, so these tests pin the actual
 * wire requests (headers, body) and how streamed responses are normalized.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'
import { AnthropicProvider, ProviderError } from '@forinda/kickjs-ai'
import type { ChatChunk, ChatMessage } from '@forinda/kickjs-ai'

interface Block {
  type: 'text' | 'tool_use' | 'thinking'
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  thinking?: string
  signature?: string
}

interface ScriptedMessage {
  content: Block[]
  stop_reason: string
  stop_details?: { type: 'refusal'; category: string | null; explanation: string | null }
  usage?: Record<string, number>
}

/** Messages API SSE events for one message. */
function eventsFor(message: ScriptedMessage): unknown[] {
  const usage = { input_tokens: 12, output_tokens: 0, ...message.usage }
  const events: unknown[] = [
    {
      type: 'message_start',
      message: {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage,
      },
    },
  ]
  message.content.forEach((block, index) => {
    if (block.type === 'text') {
      events.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } })
      events.push({
        type: 'content_block_delta',
        index,
        delta: { type: 'text_delta', text: block.text },
      })
    } else if (block.type === 'tool_use') {
      events.push({
        type: 'content_block_start',
        index,
        content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} },
      })
      events.push({
        type: 'content_block_delta',
        index,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) },
      })
    } else {
      events.push({
        type: 'content_block_start',
        index,
        content_block: { type: 'thinking', thinking: '', signature: '' },
      })
      events.push({
        type: 'content_block_delta',
        index,
        delta: { type: 'thinking_delta', thinking: block.thinking },
      })
      events.push({
        type: 'content_block_delta',
        index,
        delta: { type: 'signature_delta', signature: block.signature },
      })
    }
    events.push({ type: 'content_block_stop', index })
  })
  events.push({
    type: 'message_delta',
    delta: {
      stop_reason: message.stop_reason,
      stop_sequence: null,
      ...(message.stop_details ? { stop_details: message.stop_details } : {}),
    },
    usage: { output_tokens: usage.output_tokens || 7 },
  })
  events.push({ type: 'message_stop' })
  return events
}

function sseResponse(events: unknown[]): Response {
  const text = events
    .map(
      (event) => `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`,
    )
    .join('')
  return new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

interface Captured {
  url: string
  headers: Headers
  body: Record<string, any>
}

function setup(
  responses: Response[],
  options: ConstructorParameters<typeof AnthropicProvider>[0] = {},
) {
  const requests: Captured[] = []
  const fakeFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: String(url),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)),
    })
    const next = responses.shift()
    if (!next) throw new Error('no scripted response left')
    return next
  })
  const client = new Anthropic({ apiKey: 'sk-test', fetch: fakeFetch as never, maxRetries: 0 })
  return { provider: new AnthropicProvider({ client, ...options }), requests }
}

const user = (content: string): ChatMessage => ({ role: 'user', content })

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AnthropicProvider — request', () => {
  it('streams to the beta Messages endpoint with current defaults', async () => {
    const { provider, requests } = setup([
      sseResponse(eventsFor({ content: [{ type: 'text', text: 'hi' }], stop_reason: 'end_turn' })),
    ])

    await provider.chat({
      messages: [
        { role: 'system', content: 'You are terse.' },
        { role: 'system', content: 'Answer in English.' },
        user('hello'),
      ],
      tools: [{ name: 'lookup', description: 'Look up', inputSchema: { type: 'object' } }],
    })

    const [request] = requests
    expect(request.url).toContain('/v1/messages')
    expect(request.headers.get('x-api-key')).toBe('sk-test')
    expect(request.headers.get('anthropic-beta')).toBe('server-side-fallback-2026-07-01')
    expect(request.body).toMatchObject({
      model: 'claude-opus-5',
      max_tokens: 64000,
      stream: true,
      cache_control: { type: 'ephemeral' },
      fallbacks: 'default',
      system: 'You are terse.\n\nAnswer in English.',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      tools: [{ name: 'lookup', description: 'Look up', input_schema: { type: 'object' } }],
    })
    expect(request.body.tools[0].eager_input_streaming).toBeUndefined()
    expect(request.body.temperature).toBeUndefined()
  })

  it('drops sampling parameters on models that reject them, with one warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const reply = () =>
      sseResponse(eventsFor({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }))
    const { provider, requests } = setup([reply(), reply()])

    await provider.chat({ messages: [user('a')] }, { temperature: 0.2, topP: 0.9 })
    await provider.chat({ messages: [user('b')] }, { temperature: 0.2 })

    expect(requests[0].body.temperature).toBeUndefined()
    expect(requests[0].body.top_p).toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('sends one sampling parameter, and no fallbacks, on older models', async () => {
    const { provider, requests } = setup([
      sseResponse(eventsFor({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' })),
    ])

    await provider.chat(
      { messages: [user('a')], model: 'claude-sonnet-4-6' },
      { temperature: 0.2, topP: 0.9, maxTokens: 1000, stopSequences: ['END'] },
    )

    expect(requests[0].body).toMatchObject({
      model: 'claude-sonnet-4-6',
      temperature: 0.2,
      max_tokens: 1000,
      stop_sequences: ['END'],
    })
    expect(requests[0].body.top_p).toBeUndefined()
    expect(requests[0].body.fallbacks).toBeUndefined()
    expect(requests[0].headers.get('anthropic-beta')).toBeNull()
  })

  it('applies effort, thinking display, and turns off cache and fallbacks', async () => {
    const { provider, requests } = setup(
      [
        sseResponse(
          eventsFor({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }),
        ),
      ],
      { effort: 'low', thinkingDisplay: 'summarized', cache: false, fallbacks: false },
    )

    await provider.chat({ messages: [user('a')] }, { effort: 'medium' })

    expect(requests[0].body.output_config).toEqual({ effort: 'medium' })
    expect(requests[0].body.thinking).toEqual({ type: 'adaptive', display: 'summarized' })
    expect(requests[0].body.cache_control).toBeUndefined()
    expect(requests[0].body.fallbacks).toBeUndefined()
  })

  it('groups consecutive tool results into one user message and replays provider content', async () => {
    const { provider, requests } = setup([
      sseResponse(
        eventsFor({ content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn' }),
      ),
    ])
    const thinkingTurn = [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'tool_use', id: 'tu_1', name: 'a', input: {} },
      { type: 'tool_use', id: 'tu_2', name: 'b', input: {} },
    ]

    await provider.chat({
      messages: [
        user('go'),
        {
          role: 'assistant',
          content: '',
          toolCalls: [
            { id: 'tu_1', name: 'a', arguments: {} },
            { id: 'tu_2', name: 'b', arguments: {} },
          ],
          providerContent: thinkingTurn,
        },
        { role: 'tool', toolCallId: 'tu_1', content: '{"ok":true}' },
        { role: 'tool', toolCallId: 'tu_2', content: '{"error":"nope"}', isError: true },
      ],
    })

    expect(requests[0].body.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'go' }] },
      { role: 'assistant', content: thinkingTurn },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tu_1', content: '{"ok":true}' },
          { type: 'tool_result', tool_use_id: 'tu_2', content: '{"error":"nope"}', is_error: true },
        ],
      },
    ])
  })
})

describe('AnthropicProvider — response', () => {
  it('returns tool calls, the full content for replay, and cache usage', async () => {
    const { provider } = setup([
      sseResponse(
        eventsFor({
          content: [
            { type: 'thinking', thinking: '', signature: 'sig-1' },
            { type: 'text', text: 'Creating it.' },
            { type: 'tool_use', id: 'tu_1', name: 'create_task', input: { title: 'Ship' } },
          ],
          stop_reason: 'tool_use',
          usage: { input_tokens: 10, cache_read_input_tokens: 90, cache_creation_input_tokens: 5 },
        }),
      ),
    ])

    const response = await provider.chat({ messages: [user('make a task')] })

    expect(response.content).toBe('Creating it.')
    expect(response.toolCalls).toEqual([
      { id: 'tu_1', name: 'create_task', arguments: { title: 'Ship' } },
    ])
    expect(response.finishReason).toBe('tool_call')
    expect((response.providerContent as Array<{ type: string }>).map((b) => b.type)).toEqual([
      'thinking',
      'text',
      'tool_use',
    ])
    expect(response.usage).toEqual({
      promptTokens: 105,
      completionTokens: 7,
      totalTokens: 112,
      cacheReadTokens: 90,
      cacheWriteTokens: 5,
    })
  })

  it('leaves providerContent unset for plain text and tool calls', async () => {
    const { provider } = setup([
      sseResponse(
        eventsFor({ content: [{ type: 'text', text: 'hi' }], stop_reason: 'max_tokens' }),
      ),
    ])
    const response = await provider.chat({ messages: [user('hello')] })
    expect(response.providerContent).toBeUndefined()
    expect(response.finishReason).toBe('length')
  })

  it('reports a refusal', async () => {
    const { provider } = setup([
      sseResponse(
        eventsFor({
          content: [],
          stop_reason: 'refusal',
          stop_details: { type: 'refusal', category: 'cyber', explanation: 'Declined.' },
        }),
      ),
    ])
    const response = await provider.chat({ messages: [user('...')] })
    expect(response.finishReason).toBe('content_filter')
    expect(response.refusal).toEqual({ category: 'cyber', explanation: 'Declined.' })
  })

  it('throws ProviderError with the HTTP status on API errors', async () => {
    const { provider } = setup([
      new Response(
        JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'bad' } }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      ),
    ])
    const error = await provider.chat({ messages: [user('x')] }).catch((err) => err)
    expect(error).toBeInstanceOf(ProviderError)
    expect(error.status).toBe(400)
  })
})

describe('AnthropicProvider.stream()', () => {
  it('yields text, indexed tool deltas and a final chunk with finish reason and usage', async () => {
    const { provider, requests } = setup([
      sseResponse(
        eventsFor({
          content: [
            { type: 'text', text: 'On it.' },
            { type: 'tool_use', id: 'tu_1', name: 'create_task', input: { title: 'X' } },
          ],
          stop_reason: 'tool_use',
        }),
      ),
    ])

    const chunks: ChatChunk[] = []
    for await (const chunk of provider.stream({
      messages: [user('go')],
      tools: [{ name: 'create_task', description: 'Create', inputSchema: { type: 'object' } }],
    })) {
      chunks.push(chunk)
    }

    expect(requests[0].body.tools[0].eager_input_streaming).toBe(true)
    expect(chunks).toEqual([
      { content: 'On it.', done: false },
      { content: '', done: false, toolCallDelta: { id: 'tu_1', index: 1, name: 'create_task' } },
      {
        content: '',
        done: false,
        toolCallDelta: { id: 'tu_1', index: 1, argumentsDelta: '{"title":"X"}' },
      },
      {
        content: '',
        done: true,
        finishReason: 'tool_call',
        usage: { promptTokens: 12, completionTokens: 7, totalTokens: 19 },
      },
    ])
  })

  it('rejects when the API sends an error event mid-stream', async () => {
    const [start, blockStart, delta] = eventsFor({
      content: [{ type: 'text', text: 'partial' }],
      stop_reason: 'end_turn',
    })
    const { provider } = setup([
      sseResponse([
        start,
        blockStart,
        delta,
        { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
      ]),
    ])

    const chunks: ChatChunk[] = []
    const consume = async () => {
      for await (const chunk of provider.stream({ messages: [user('go')] })) chunks.push(chunk)
    }
    await expect(consume()).rejects.toThrow(/Overloaded/)
    expect(chunks.some((c) => c.done)).toBe(false)
  })
})

describe('AnthropicProvider.embed()', () => {
  it('throws a descriptive error pointing to embedding-capable providers', async () => {
    const { provider } = setup([])
    await expect(provider.embed('x')).rejects.toThrow(/does not provide an embeddings API/)
  })
})
