/**
 * chat({ schema }): the schema on the wire (OpenAI response_format, Anthropic
 * a forced tool call), the answer parsed and validated into `object`, bad
 * answers sent back with what was wrong, and StructuredOutputError at the end.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import {
  AnthropicProvider,
  OpenAIProvider,
  StructuredOutputError,
  chatObject,
} from '@forinda/kickjs-ai'

const Advice = z.object({ summary: z.string(), steps: z.array(z.string()) })
const ask = [{ role: 'user' as const, content: 'How do I rotate my API keys?' }]

afterEach(() => vi.restoreAllMocks())

describe('OpenAIProvider with a schema', () => {
  function setup(answers: string[]) {
    const bodies: any[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)))
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: answers.shift() }, finish_reason: 'stop' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })
    return { provider: new OpenAIProvider({ apiKey: 'sk-test' }), bodies }
  }

  it('sends response_format and returns the validated object', async () => {
    const { provider, bodies } = setup(['{"summary":"Rotate","steps":["create","swap","revoke"]}'])
    const res = await provider.chat({ messages: ask, schema: Advice, schemaName: 'advice' })
    expect(res.object).toEqual({ summary: 'Rotate', steps: ['create', 'swap', 'revoke'] })
    expect(bodies[0].response_format).toEqual({
      type: 'json_schema',
      json_schema: {
        name: 'advice',
        strict: true,
        schema: expect.objectContaining({
          type: 'object',
          required: ['summary', 'steps'],
          additionalProperties: false,
        }),
      },
    })
  })

  it('sends a bad answer back with what was wrong, then succeeds', async () => {
    const { provider, bodies } = setup([
      '{"summary":"Rotate"}',
      '{"summary":"Rotate","steps":["a"]}',
    ])
    const res = await provider.chat({ messages: ask, schema: Advice })
    expect(res.object).toEqual({ summary: 'Rotate', steps: ['a'] })
    const retry = bodies[1].messages
    expect(retry.slice(-2)).toEqual([
      { role: 'assistant', content: '{"summary":"Rotate"}' },
      { role: 'user', content: expect.stringContaining('steps:') },
    ])
  })

  it('throws StructuredOutputError once the retries run out', async () => {
    const { provider } = setup(['not json', 'still not json'])
    const err = await provider.chat({ messages: ask, schema: Advice }).catch((e) => e)
    expect(err).toBeInstanceOf(StructuredOutputError)
    expect(err.issues).toEqual(['the answer was not valid JSON'])
    expect(err.raw).toBe('still not json')
  })

  it('wraps a non-object schema as { value } and unwraps the answer', async () => {
    const { provider, bodies } = setup(['{"value":["a","b"]}'])
    const steps = await chatObject(provider, { messages: ask, schema: z.array(z.string()) })
    expect(steps).toEqual(['a', 'b'])
    expect(bodies[0].response_format.json_schema.schema).toMatchObject({
      type: 'object',
      properties: { value: { type: 'array' } },
      required: ['value'],
    })
  })

  it('sends a plain JSON Schema as is, not strict when optional fields make it open', async () => {
    const { provider, bodies } = setup(['{"name":"x"}'])
    const schema = {
      type: 'object',
      properties: { name: { type: 'string' }, tag: { type: 'string' } },
      required: ['name'],
    }
    const res = await provider.chat({ messages: ask, schema })
    expect(res.object).toEqual({ name: 'x' })
    expect(bodies[0].response_format.json_schema).toMatchObject({ schema, strict: false })
  })

  it('refuses a schema on stream()', async () => {
    const { provider } = setup([])
    const it = provider.stream({ messages: ask, schema: Advice })[Symbol.asyncIterator]()
    await expect(it.next()).rejects.toThrow(/chat\(\), not stream\(\)/)
  })
})

/** Messages API SSE for one assistant turn that calls `tool` with `input`. */
function toolUseStream(tool: string, input: unknown): Response {
  const events = [
    {
      type: 'message_start',
      message: {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5-5',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 0 },
      },
    },
    {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'tu_1', name: tool, input: {} },
    },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) },
    },
    { type: 'content_block_stop', index: 0 },
    {
      type: 'message_delta',
      delta: { stop_reason: 'tool_use', stop_sequence: null },
      usage: { output_tokens: 5 },
    },
    { type: 'message_stop' },
  ]
  return new Response(
    events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''),
    {
      headers: { 'content-type': 'text/event-stream' },
    },
  )
}

describe('AnthropicProvider with a schema', () => {
  function setup(answers: unknown[]) {
    const bodies: any[] = []
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return toolUseStream('response', answers.shift())
    })
    const client = new Anthropic({ apiKey: 'sk-test', fetch: fetch as never, maxRetries: 0 })
    return { provider: new AnthropicProvider({ client, thinkingDisplay: 'summarized' }), bodies }
  }

  it('forces a tool call with the schema, thinking off, and returns its input as the object', async () => {
    const { provider, bodies } = setup([{ summary: 'Rotate', steps: ['swap'] }])
    const res = await provider.chat({ messages: ask, schema: Advice })
    expect(bodies[0].tools).toEqual([
      expect.objectContaining({
        name: 'response',
        input_schema: expect.objectContaining({ type: 'object', required: ['summary', 'steps'] }),
      }),
    ])
    expect(bodies[0].tool_choice).toEqual({ type: 'tool', name: 'response' })
    expect(bodies[0].thinking).toEqual({ type: 'disabled' })
    expect(res.object).toEqual({ summary: 'Rotate', steps: ['swap'] })
    expect(res.content).toBe('{"summary":"Rotate","steps":["swap"]}')
    expect(res.toolCalls).toBeUndefined()
    expect(res.finishReason).toBe('stop')
  })

  it('retries a call whose input fails validation', async () => {
    const { provider, bodies } = setup([{ summary: 1 }, { summary: 'ok', steps: [] }])
    const res = await provider.chat({ messages: ask, schema: Advice })
    expect(res.object).toEqual({ summary: 'ok', steps: [] })
    expect(bodies).toHaveLength(2)
    expect(JSON.stringify(bodies[1].messages.at(-1))).toContain('summary')
  })

  it('refuses tools alongside a schema', async () => {
    const { provider } = setup([])
    await expect(
      provider.chat({
        messages: ask,
        schema: Advice,
        tools: [{ name: 't', description: 'd', inputSchema: { type: 'object' } }],
      }),
    ).rejects.toThrow(/schema and tools can't be combined/)
  })
})
