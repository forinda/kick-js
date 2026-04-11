/**
 * Unit tests for the `kick explain --ai` LLM fallback.
 *
 * The fallback imports `@forinda/kickjs-ai` dynamically, so these
 * tests mock the module via `vi.mock` and supply a stubbed
 * `OpenAIProvider` whose `chat` method returns scripted responses.
 * That lets us exercise every branch — success, malformed JSON,
 * missing API key, transport error, markdown-fenced JSON — without
 * touching the real OpenAI API or the actual provider implementation.
 *
 * @module @forinda/kickjs-cli/__tests__/ai-fallback.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { askAi } from '../src/explain/ai-fallback'

// ── Mock @forinda/kickjs-ai ──────────────────────────────────────────────

const mockChat = vi.fn()

vi.mock('@forinda/kickjs-ai', () => ({
  OpenAIProvider: class MockOpenAIProvider {
    constructor(public readonly options: unknown) {}
    chat(input: unknown, options?: unknown) {
      return mockChat(input, options)
    }
  },
}))

// ── Test harness ─────────────────────────────────────────────────────────

const ORIGINAL_KEY = process.env.OPENAI_API_KEY

beforeEach(() => {
  process.env.OPENAI_API_KEY = 'sk-test'
  mockChat.mockReset()
})

afterEach(() => {
  if (ORIGINAL_KEY === undefined) {
    delete process.env.OPENAI_API_KEY
  } else {
    process.env.OPENAI_API_KEY = ORIGINAL_KEY
  }
})

// ── unavailable branches ─────────────────────────────────────────────────

describe('askAi — unavailable', () => {
  it('returns unavailable when OPENAI_API_KEY is missing', async () => {
    delete process.env.OPENAI_API_KEY

    const result = await askAi({ input: 'something broke' })

    expect(result.kind).toBe('unavailable')
    if (result.kind === 'unavailable') {
      expect(result.reason).toMatch(/OPENAI_API_KEY/)
      expect(result.suggestion).toContain('export OPENAI_API_KEY')
    }
    expect(mockChat).not.toHaveBeenCalled()
  })
})

// ── ok path ──────────────────────────────────────────────────────────────

describe('askAi — success', () => {
  it('returns a Diagnosis when the LLM responds with valid JSON', async () => {
    mockChat.mockResolvedValueOnce({
      content: JSON.stringify({
        id: 'custom-error',
        title: 'Custom error title',
        explanation: 'Long explanation of the problem.',
        fix: 'Do this to fix it.',
        docs: 'https://example.com/docs',
      }),
    })

    const result = await askAi({ input: 'obscure runtime error' })

    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') {
      expect(result.diagnosis.id).toBe('custom-error')
      expect(result.diagnosis.title).toBe('Custom error title')
      expect(result.diagnosis.explanation).toContain('Long explanation')
      expect(result.diagnosis.fix).toContain('Do this')
      expect(result.diagnosis.docs).toBe('https://example.com/docs')
    }
    expect(mockChat).toHaveBeenCalledTimes(1)
  })

  it('parses a JSON payload wrapped in a markdown fence', async () => {
    mockChat.mockResolvedValueOnce({
      content:
        "Here's the diagnosis:\n\n" +
        '```json\n' +
        JSON.stringify({
          id: 'fenced-error',
          title: 'Fenced title',
          explanation: 'E',
          fix: 'F',
        }) +
        '\n```\n\n' +
        'Hope that helps!',
    })

    const result = await askAi({ input: 'error' })

    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') {
      expect(result.diagnosis.id).toBe('fenced-error')
    }
  })

  it('extracts a JSON object from a response with surrounding prose', async () => {
    mockChat.mockResolvedValueOnce({
      content:
        'Sure! Here is what I found:\n' +
        JSON.stringify({
          id: 'prose-error',
          title: 'Title from prose',
          explanation: 'Explanation',
          fix: 'Fix',
        }) +
        '\nLet me know if you need more details.',
    })

    const result = await askAi({ input: 'error' })

    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') {
      expect(result.diagnosis.id).toBe('prose-error')
    }
  })

  it('passes the user input to the chat call', async () => {
    mockChat.mockResolvedValueOnce({
      content: JSON.stringify({
        id: 'x',
        title: 'x',
        explanation: 'x',
        fix: 'x',
      }),
    })

    await askAi({ input: 'config.get returned undefined' })

    const [input] = mockChat.mock.calls[0]
    const userMessage = input.messages.find((m: { role: string }) => m.role === 'user')
    expect(userMessage.content).toContain('config.get returned undefined')
  })

  it('includes a KickJS-aware system prompt', async () => {
    mockChat.mockResolvedValueOnce({
      content: JSON.stringify({
        id: 'x',
        title: 'x',
        explanation: 'x',
        fix: 'x',
      }),
    })

    await askAi({ input: 'error' })

    const [input] = mockChat.mock.calls[0]
    const systemMessage = input.messages.find((m: { role: string }) => m.role === 'system')
    expect(systemMessage.content).toContain('KickJS')
    expect(systemMessage.content).toContain('AppModule')
    expect(systemMessage.content).toContain('forinda.github.io/kick-js')
  })
})

// ── error branches ───────────────────────────────────────────────────────

describe('askAi — error', () => {
  it('returns an error result when the LLM returns non-JSON text', async () => {
    mockChat.mockResolvedValueOnce({
      content: 'I have no idea what that error means, sorry!',
    })

    const result = await askAi({ input: 'error' })

    expect(result.kind).toBe('error')
    if (result.kind === 'error') {
      expect(result.message).toContain('not valid JSON')
    }
  })

  it('returns an error result when the LLM returns JSON missing required fields', async () => {
    mockChat.mockResolvedValueOnce({
      content: JSON.stringify({ id: 'incomplete' }),
    })

    const result = await askAi({ input: 'error' })

    expect(result.kind).toBe('error')
  })

  it('returns an error result when the provider throws', async () => {
    mockChat.mockRejectedValueOnce(new Error('rate limit exceeded'))

    const result = await askAi({ input: 'error' })

    expect(result.kind).toBe('error')
    if (result.kind === 'error') {
      expect(result.message).toContain('rate limit exceeded')
    }
  })
})
