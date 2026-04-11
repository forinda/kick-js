/**
 * Tests for `OpenAIProvider`.
 *
 * Every test mocks the global `fetch` so the suite never touches the
 * real OpenAI API. Two patterns:
 *
 *  1. JSON responses (chat, embed) — `mockFetch` returns a Response
 *     with a fake JSON body and we assert on the normalized
 *     framework-shape result.
 *
 *  2. Streaming SSE (stream) — we build a ReadableStream that emits
 *     pre-canned `data: {...}\n` chunks plus a `[DONE]` sentinel,
 *     then assert on the sequence of `ChatChunk`s the provider yields.
 *
 * @module @forinda/kickjs-ai/__tests__/openai-provider.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { OpenAIProvider, ProviderError } from '../src'

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
 * Build a fake SSE stream that emits the given pre-encoded events
 * (one per `data: ` line) followed by `data: [DONE]`. Each event
 * gets its own line + trailing newline so the provider's line buffer
 * sees them separately.
 */
function mockStreamResponse(events: unknown[]): Response {
  const lines = events.map((e) => `data: ${JSON.stringify(e)}\n`).concat('data: [DONE]\n')
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

describe('OpenAIProvider — construction', () => {
  it('requires an apiKey', () => {
    expect(() => new OpenAIProvider({ apiKey: '' })).toThrow(/apiKey is required/)
  })

  it('exposes name as "openai" by default', () => {
    const p = new OpenAIProvider({ apiKey: 'sk-test' })
    expect(p.name).toBe('openai')
  })

  it('accepts a name override (for compatible endpoints)', () => {
    const p = new OpenAIProvider({ apiKey: 'sk-test', name: 'ollama' })
    expect(p.name).toBe('ollama')
  })

  it('strips trailing slash from baseURL', () => {
    const p = new OpenAIProvider({ apiKey: 'sk-test', baseURL: 'https://example.com/v1/' })
    // We can verify by triggering a call and reading the URL fetch was given.
    fetchSpy.mockResolvedValueOnce(
      mockJsonResponse({ choices: [{ message: { content: 'hi' } }] }),
    )
    return p
      .chat({ messages: [{ role: 'user', content: 'hello' }] })
      .then(() => {
        const call = fetchSpy.mock.calls[0]
        expect(call?.[0]).toBe('https://example.com/v1/chat/completions')
      })
  })
})

// ── chat ──────────────────────────────────────────────────────────────────

describe('OpenAIProvider.chat()', () => {
  it('posts to /chat/completions with the right wire shape', async () => {
    const provider = new OpenAIProvider({ apiKey: 'sk-test', defaultChatModel: 'gpt-4o-mini' })
    fetchSpy.mockResolvedValueOnce(
      mockJsonResponse({
        choices: [
          {
            message: { content: 'Hello!' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    )

    const res = await provider.chat({
      messages: [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'say hi' },
      ],
    })

    // Wire-format assertions
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test')
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('gpt-4o-mini')
    expect(body.stream).toBe(false)
    expect(body.messages).toEqual([
      { role: 'system', content: 'be brief' },
      { role: 'user', content: 'say hi' },
    ])

    // Normalized response
    expect(res.content).toBe('Hello!')
    expect(res.finishReason).toBe('stop')
    expect(res.usage).toEqual({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    })
    expect(res.toolCalls).toBeUndefined()
  })

  it('honors per-call options (temperature, maxTokens, topP, stop)', async () => {
    const provider = new OpenAIProvider({ apiKey: 'sk-test' })
    fetchSpy.mockResolvedValueOnce(mockJsonResponse({ choices: [{ message: { content: '' } }] }))

    await provider.chat(
      { messages: [{ role: 'user', content: 'q' }] },
      { temperature: 0.2, maxTokens: 256, topP: 0.9, stopSequences: ['END'] },
    )

    const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string)
    expect(body.temperature).toBe(0.2)
    expect(body.max_tokens).toBe(256)
    expect(body.top_p).toBe(0.9)
    expect(body.stop).toEqual(['END'])
  })

  it('surfaces tool calls in the normalized response', async () => {
    const provider = new OpenAIProvider({ apiKey: 'sk-test' })
    fetchSpy.mockResolvedValueOnce(
      mockJsonResponse({
        choices: [
          {
            message: {
              content: '',
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: {
                    name: 'create_task',
                    arguments: JSON.stringify({ title: 'Ship', priority: 'high' }),
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      }),
    )

    const res = await provider.chat({ messages: [{ role: 'user', content: 'make a task' }] })
    expect(res.toolCalls).toEqual([
      { id: 'call_1', name: 'create_task', arguments: { title: 'Ship', priority: 'high' } },
    ])
    expect(res.finishReason).toBe('tool_calls')
  })

  it('passes through tool messages and assistant tool_calls in requests', async () => {
    const provider = new OpenAIProvider({ apiKey: 'sk-test' })
    fetchSpy.mockResolvedValueOnce(mockJsonResponse({ choices: [{ message: { content: 'ok' } }] }))

    await provider.chat({
      messages: [
        { role: 'user', content: 'make a task' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [
            { id: 'call_1', name: 'create_task', arguments: { title: 'X' } },
          ],
        },
        { role: 'tool', content: '{"id":"created"}', toolCallId: 'call_1' },
      ],
    })

    const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string)
    expect(body.messages[1]).toEqual({
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'create_task', arguments: '{"title":"X"}' },
        },
      ],
    })
    expect(body.messages[2]).toEqual({
      role: 'tool',
      tool_call_id: 'call_1',
      content: '{"id":"created"}',
    })
  })

  it('throws ProviderError with status + body on non-2xx', async () => {
    const provider = new OpenAIProvider({ apiKey: 'bad-key' })
    fetchSpy.mockResolvedValueOnce(mockErrorResponse('{"error":"invalid api key"}', 401))

    await expect(provider.chat({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow(
      ProviderError,
    )

    fetchSpy.mockResolvedValueOnce(mockErrorResponse('{"error":"rate limit"}', 429))
    try {
      await provider.chat({ messages: [{ role: 'user', content: 'hi' }] })
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError)
      expect((err as ProviderError).status).toBe(429)
      expect((err as ProviderError).body).toContain('rate limit')
    }
  })
})

// ── stream ────────────────────────────────────────────────────────────────

describe('OpenAIProvider.stream()', () => {
  it('yields content deltas and a final done chunk', async () => {
    const provider = new OpenAIProvider({ apiKey: 'sk-test' })
    fetchSpy.mockResolvedValueOnce(
      mockStreamResponse([
        { choices: [{ delta: { content: 'Hel' } }] },
        { choices: [{ delta: { content: 'lo!' } }] },
        { choices: [{ delta: {} }] },
      ]),
    )

    const chunks = []
    for await (const chunk of provider.stream({
      messages: [{ role: 'user', content: 'say hi' }],
    })) {
      chunks.push(chunk)
    }

    // Three content deltas + one done
    const content = chunks
      .filter((c) => !c.done)
      .map((c) => c.content)
      .join('')
    expect(content).toBe('Hello!')
    expect(chunks[chunks.length - 1].done).toBe(true)
  })

  it('sets stream: true on the request body', async () => {
    const provider = new OpenAIProvider({ apiKey: 'sk-test' })
    fetchSpy.mockResolvedValueOnce(
      mockStreamResponse([{ choices: [{ delta: { content: 'x' } }] }]),
    )

    const iter = provider.stream({ messages: [{ role: 'user', content: 'q' }] })
    // Consume so the request actually fires
    for await (const _ of iter) {
      /* drain */
    }

    const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string)
    expect(body.stream).toBe(true)
  })

  it('surfaces tool call deltas in the chunk stream', async () => {
    const provider = new OpenAIProvider({ apiKey: 'sk-test' })
    fetchSpy.mockResolvedValueOnce(
      mockStreamResponse([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_1',
                    function: { name: 'create_task', arguments: '{"title":"X"}' },
                  },
                ],
              },
            },
          ],
        },
      ]),
    )

    const chunks = []
    for await (const chunk of provider.stream({
      messages: [{ role: 'user', content: 'make a task' }],
    })) {
      chunks.push(chunk)
    }

    const withTool = chunks.find((c) => c.toolCallDelta)
    expect(withTool?.toolCallDelta).toEqual({
      id: 'call_1',
      name: 'create_task',
      argumentsDelta: '{"title":"X"}',
    })
  })

  it('throws ProviderError on streaming endpoint errors', async () => {
    const provider = new OpenAIProvider({ apiKey: 'bad-key' })
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

describe('OpenAIProvider.embed()', () => {
  it('embeds a single string and returns a length-1 vector array', async () => {
    const provider = new OpenAIProvider({ apiKey: 'sk-test' })
    fetchSpy.mockResolvedValueOnce(
      mockJsonResponse({ data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }] }),
    )

    const vectors = await provider.embed('hello world')
    expect(vectors).toEqual([[0.1, 0.2, 0.3]])
  })

  it('embeds an array of strings and returns vectors in input order', async () => {
    const provider = new OpenAIProvider({ apiKey: 'sk-test' })
    // OpenAI returns indexes in arbitrary order; the provider should re-sort.
    fetchSpy.mockResolvedValueOnce(
      mockJsonResponse({
        data: [
          { index: 1, embedding: [0.4, 0.5] },
          { index: 0, embedding: [0.1, 0.2] },
        ],
      }),
    )

    const vectors = await provider.embed(['first', 'second'])
    expect(vectors).toEqual([
      [0.1, 0.2],
      [0.4, 0.5],
    ])
  })

  it('returns an empty array for empty input', async () => {
    const provider = new OpenAIProvider({ apiKey: 'sk-test' })
    const vectors = await provider.embed([])
    expect(vectors).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('uses the configured default embed model', async () => {
    const provider = new OpenAIProvider({
      apiKey: 'sk-test',
      defaultEmbedModel: 'text-embedding-3-large',
    })
    fetchSpy.mockResolvedValueOnce(mockJsonResponse({ data: [{ index: 0, embedding: [1] }] }))

    await provider.embed('x')
    const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string)
    expect(body.model).toBe('text-embedding-3-large')
  })
})

// ── organization header ──────────────────────────────────────────────────

describe('OpenAIProvider — organization header', () => {
  it('omits the openai-organization header when not configured', async () => {
    const provider = new OpenAIProvider({ apiKey: 'sk-test' })
    fetchSpy.mockResolvedValueOnce(mockJsonResponse({ choices: [{ message: { content: '' } }] }))
    await provider.chat({ messages: [{ role: 'user', content: 'q' }] })

    const headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>
    expect(headers['openai-organization']).toBeUndefined()
  })

  it('includes the openai-organization header when configured', async () => {
    const provider = new OpenAIProvider({ apiKey: 'sk-test', organization: 'org_42' })
    fetchSpy.mockResolvedValueOnce(mockJsonResponse({ choices: [{ message: { content: '' } }] }))
    await provider.chat({ messages: [{ role: 'user', content: 'q' }] })

    const headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>
    expect(headers['openai-organization']).toBe('org_42')
  })
})
