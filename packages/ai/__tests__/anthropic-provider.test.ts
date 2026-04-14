/**
 * Tests for `AnthropicProvider`.
 *
 * Mocks `globalThis.fetch` the same way as the OpenAI suite. Two
 * flows exercised:
 *
 *   1. JSON responses for `chat()` — verify wire shape (headers,
 *      system extraction, content blocks, tool_use/tool_result) and
 *      normalized `ChatResponse`.
 *
 *   2. SSE streams for `stream()` — Anthropic uses distinct event
 *      types (`content_block_start`, `content_block_delta`,
 *      `message_stop`) rather than a single delta channel, so the
 *      fake stream builder emits those shapes.
 *
 * `embed()` is tested separately since Anthropic does not ship an
 * embeddings API — the provider must throw a descriptive error rather
 * than returning an empty vector.
 *
 * @module @forinda/kickjs-ai/__tests__/anthropic-provider.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { AnthropicProvider, ProviderError } from '../src'

// ── Helpers ───────────────────────────────────────────────────────────────

let fetchSpy: ReturnType<typeof vi.spyOn>

function mockJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function mockErrorResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain' },
  })
}

/**
 * Build a fake SSE stream that encodes Anthropic-style events. Each
 * event arrives as a `data: {...}` line; the stream terminates when
 * the underlying ReadableStream closes, matching how the provider's
 * line-buffered SSE parser consumes it.
 */
function mockStreamResponse(events: unknown[]): Response {
  const lines = events.map((e) => `data: ${JSON.stringify(e)}\n`)
  const body = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()
      for (const line of lines) controller.enqueue(encoder.encode(line))
      controller.close()
    },
  })
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch')
})

afterEach(() => {
  fetchSpy.mockRestore()
})

// ── Construction ──────────────────────────────────────────────────────────

describe('AnthropicProvider — construction', () => {
  it('requires an apiKey', () => {
    expect(() => new AnthropicProvider({ apiKey: '' })).toThrow(/apiKey is required/)
  })

  it('exposes name as "anthropic" by default', () => {
    const p = new AnthropicProvider({ apiKey: 'sk-ant-test' })
    expect(p.name).toBe('anthropic')
  })

  it('accepts a name override (for compatible endpoints)', () => {
    const p = new AnthropicProvider({ apiKey: 'sk-ant-test', name: 'gateway' })
    expect(p.name).toBe('gateway')
  })

  it('strips trailing slash from baseURL', async () => {
    const p = new AnthropicProvider({
      apiKey: 'sk-ant-test',
      baseURL: 'https://example.com/v1/',
    })
    fetchSpy.mockResolvedValueOnce(
      mockJsonResponse({ content: [{ type: 'text', text: 'hi' }] }),
    )
    await p.chat({ messages: [{ role: 'user', content: 'hello' }] })
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://example.com/v1/messages')
  })
})

// ── chat ──────────────────────────────────────────────────────────────────

describe('AnthropicProvider.chat()', () => {
  it('posts to /messages with x-api-key and anthropic-version headers', async () => {
    const provider = new AnthropicProvider({
      apiKey: 'sk-ant-test',
      defaultChatModel: 'claude-opus-4-6',
    })
    fetchSpy.mockResolvedValueOnce(
      mockJsonResponse({
        content: [{ type: 'text', text: 'Hello!' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    )

    const res = await provider.chat({
      messages: [{ role: 'user', content: 'say hi' }],
    })

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers['x-api-key']).toBe('sk-ant-test')
    expect(headers['anthropic-version']).toBe('2023-06-01')

    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('claude-opus-4-6')
    expect(body.max_tokens).toBe(4096) // default
    expect(body.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'say hi' }] },
    ])
    expect(body.system).toBeUndefined()
    expect(body.stream).toBeUndefined()

    expect(res.content).toBe('Hello!')
    expect(res.finishReason).toBe('end_turn')
    expect(res.usage).toEqual({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    })
    expect(res.toolCalls).toBeUndefined()
  })

  it('extracts system messages into the top-level system field', async () => {
    const provider = new AnthropicProvider({ apiKey: 'sk-ant-test' })
    fetchSpy.mockResolvedValueOnce(
      mockJsonResponse({ content: [{ type: 'text', text: 'ok' }] }),
    )

    await provider.chat({
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'hi' },
      ],
    })

    const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string)
    expect(body.system).toBe('You are helpful.')
    expect(body.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    ])
  })

  it('drops additional system messages beyond the first', async () => {
    const provider = new AnthropicProvider({ apiKey: 'sk-ant-test' })
    fetchSpy.mockResolvedValueOnce(
      mockJsonResponse({ content: [{ type: 'text', text: 'ok' }] }),
    )

    await provider.chat({
      messages: [
        { role: 'system', content: 'first' },
        { role: 'system', content: 'ignored' },
        { role: 'user', content: 'q' },
      ],
    })

    const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string)
    expect(body.system).toBe('first')
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(['user'])
  })

  it('honors per-call options (temperature, maxTokens, topP, stopSequences)', async () => {
    const provider = new AnthropicProvider({ apiKey: 'sk-ant-test' })
    fetchSpy.mockResolvedValueOnce(mockJsonResponse({ content: [] }))

    await provider.chat(
      { messages: [{ role: 'user', content: 'q' }] },
      { temperature: 0.3, maxTokens: 256, topP: 0.9, stopSequences: ['END'] },
    )

    const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string)
    expect(body.temperature).toBe(0.3)
    expect(body.max_tokens).toBe(256)
    expect(body.top_p).toBe(0.9)
    expect(body.stop_sequences).toEqual(['END'])
  })

  it('falls back to defaultMaxTokens when maxTokens is not set', async () => {
    const provider = new AnthropicProvider({
      apiKey: 'sk-ant-test',
      defaultMaxTokens: 2048,
    })
    fetchSpy.mockResolvedValueOnce(mockJsonResponse({ content: [] }))

    await provider.chat({ messages: [{ role: 'user', content: 'q' }] })

    const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string)
    expect(body.max_tokens).toBe(2048)
  })

  it('translates tool definitions to the input_schema wire shape', async () => {
    const provider = new AnthropicProvider({ apiKey: 'sk-ant-test' })
    fetchSpy.mockResolvedValueOnce(mockJsonResponse({ content: [] }))

    await provider.chat({
      messages: [{ role: 'user', content: 'q' }],
      tools: [
        {
          name: 'create_task',
          description: 'Create a new task',
          inputSchema: {
            type: 'object',
            properties: { title: { type: 'string' } },
          },
        },
      ],
    })

    const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string)
    expect(body.tools).toEqual([
      {
        name: 'create_task',
        description: 'Create a new task',
        input_schema: {
          type: 'object',
          properties: { title: { type: 'string' } },
        },
      },
    ])
  })

  it('surfaces tool_use content blocks in the normalized response', async () => {
    const provider = new AnthropicProvider({ apiKey: 'sk-ant-test' })
    fetchSpy.mockResolvedValueOnce(
      mockJsonResponse({
        content: [
          { type: 'text', text: 'Calling tool:' },
          {
            type: 'tool_use',
            id: 'tool_1',
            name: 'create_task',
            input: { title: 'Ship', priority: 'high' },
          },
        ],
        stop_reason: 'tool_use',
      }),
    )

    const res = await provider.chat({
      messages: [{ role: 'user', content: 'make a task' }],
    })

    expect(res.content).toBe('Calling tool:')
    expect(res.toolCalls).toEqual([
      {
        id: 'tool_1',
        name: 'create_task',
        arguments: { title: 'Ship', priority: 'high' },
      },
    ])
    expect(res.finishReason).toBe('tool_use')
  })

  it('translates assistant tool calls and tool result messages in requests', async () => {
    const provider = new AnthropicProvider({ apiKey: 'sk-ant-test' })
    fetchSpy.mockResolvedValueOnce(
      mockJsonResponse({ content: [{ type: 'text', text: 'done' }] }),
    )

    await provider.chat({
      messages: [
        { role: 'user', content: 'make a task' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [
            { id: 'tool_1', name: 'create_task', arguments: { title: 'X' } },
          ],
        },
        { role: 'tool', content: '{"id":"created"}', toolCallId: 'tool_1' },
      ],
    })

    const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string)
    expect(body.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'make a task' }] },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'tool_1',
            name: 'create_task',
            input: { title: 'X' },
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tool_1',
            content: '{"id":"created"}',
          },
        ],
      },
    ])
  })

  it('throws ProviderError with status + body on non-2xx', async () => {
    const provider = new AnthropicProvider({ apiKey: 'bad-key' })
    fetchSpy.mockResolvedValueOnce(mockErrorResponse('{"error":"invalid api key"}', 401))

    await expect(
      provider.chat({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(ProviderError)

    // Non-retryable error — check status and body are captured
    fetchSpy.mockResolvedValueOnce(mockErrorResponse('{"error":"rate limit"}', 400))
    try {
      await provider.chat({ messages: [{ role: 'user', content: 'hi' }] })
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError)
      expect((err as ProviderError).status).toBe(400)
      expect((err as ProviderError).body).toContain('rate limit')
    }
  })
})

// ── stream ────────────────────────────────────────────────────────────────

describe('AnthropicProvider.stream()', () => {
  it('yields content deltas and a final done chunk on message_stop', async () => {
    const provider = new AnthropicProvider({ apiKey: 'sk-ant-test' })
    fetchSpy.mockResolvedValueOnce(
      mockStreamResponse([
        { type: 'message_start', message: { id: 'msg_1' } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Hel' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'lo!' },
        },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_stop' },
      ]),
    )

    const chunks = []
    for await (const chunk of provider.stream({
      messages: [{ role: 'user', content: 'say hi' }],
    })) {
      chunks.push(chunk)
    }

    const content = chunks
      .filter((c) => !c.done)
      .map((c) => c.content)
      .join('')
    expect(content).toBe('Hello!')
    expect(chunks[chunks.length - 1].done).toBe(true)
  })

  it('sets stream: true on the request body', async () => {
    const provider = new AnthropicProvider({ apiKey: 'sk-ant-test' })
    fetchSpy.mockResolvedValueOnce(mockStreamResponse([{ type: 'message_stop' }]))

    const iter = provider.stream({ messages: [{ role: 'user', content: 'q' }] })
    for await (const _ of iter) {
      /* drain */
    }

    const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string)
    expect(body.stream).toBe(true)
  })

  it('surfaces tool_use block starts and input_json deltas', async () => {
    const provider = new AnthropicProvider({ apiKey: 'sk-ant-test' })
    fetchSpy.mockResolvedValueOnce(
      mockStreamResponse([
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 'tool_1', name: 'create_task' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '{"title":' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '"X"}' },
        },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_stop' },
      ]),
    )

    const chunks = []
    for await (const chunk of provider.stream({
      messages: [{ role: 'user', content: 'make a task' }],
    })) {
      chunks.push(chunk)
    }

    const toolStart = chunks.find((c) => c.toolCallDelta?.name)
    expect(toolStart?.toolCallDelta).toEqual({ id: 'tool_1', name: 'create_task' })

    const deltas = chunks
      .filter((c) => c.toolCallDelta?.argumentsDelta !== undefined)
      .map((c) => c.toolCallDelta!.argumentsDelta)
      .join('')
    expect(deltas).toBe('{"title":"X"}')
  })

  it('skips malformed JSON events without crashing the stream', async () => {
    const provider = new AnthropicProvider({ apiKey: 'sk-ant-test' })

    // Construct a stream with one valid event sandwiching a garbage line.
    const lines = [
      'data: not-json-at-all\n',
      `data: ${JSON.stringify({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'ok' },
      })}\n`,
      `data: ${JSON.stringify({ type: 'message_stop' })}\n`,
    ]
    const body = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder()
        for (const line of lines) controller.enqueue(encoder.encode(line))
        controller.close()
      },
    })
    fetchSpy.mockResolvedValueOnce(
      new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    )

    const chunks = []
    for await (const chunk of provider.stream({
      messages: [{ role: 'user', content: 'q' }],
    })) {
      chunks.push(chunk)
    }

    const text = chunks
      .filter((c) => !c.done)
      .map((c) => c.content)
      .join('')
    expect(text).toBe('ok')
    expect(chunks[chunks.length - 1].done).toBe(true)
  })

  it('throws ProviderError on streaming endpoint errors', async () => {
    const provider = new AnthropicProvider({ apiKey: 'bad-key' })
    fetchSpy.mockResolvedValueOnce(mockErrorResponse('unauthorized', 401))

    const iter = provider.stream({ messages: [{ role: 'user', content: 'q' }] })
    await expect(async () => {
      for await (const _ of iter) {
        /* should throw before yielding */
      }
    }).rejects.toThrow(ProviderError)
  })
})

// ── embed ─────────────────────────────────────────────────────────────────

describe('AnthropicProvider.embed()', () => {
  it('throws a descriptive error pointing to embedding-capable providers', async () => {
    const provider = new AnthropicProvider({ apiKey: 'sk-ant-test' })
    await expect(provider.embed('hello')).rejects.toThrow(
      /does not provide an embeddings API/,
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
