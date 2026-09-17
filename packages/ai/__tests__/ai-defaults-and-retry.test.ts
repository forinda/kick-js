/**
 * AiAdapter `defaults` reach the provider, and the provider HTTP helper
 * surfaces an abort during retry backoff as an abort.
 */
import 'reflect-metadata'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AiAdapter } from '@forinda/kickjs-ai'
import type { AiProvider, ChatInput, ChatOptions, ChatResponse } from '@forinda/kickjs-ai'
import { postJson } from '../src/providers/base'

class RecordingProvider implements AiProvider {
  readonly name = 'recording'
  readonly calls: Array<{ input: ChatInput; options?: ChatOptions }> = []
  async chat(input: ChatInput, options?: ChatOptions): Promise<ChatResponse> {
    this.calls.push({ input, options })
    return { content: 'ok', finishReason: 'stop' }
  }
  // eslint-disable-next-line require-yield
  async *stream(): AsyncGenerator<never> {
    throw new Error('not used')
  }
  async embed(): Promise<number[][]> {
    return []
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AiAdapter — defaults', () => {
  it('applies defaults to runAgent, with per-call values taking precedence', async () => {
    const provider = new RecordingProvider()
    const adapter = AiAdapter({
      provider,
      defaults: { model: 'default-model', temperature: 0.1, maxTokens: 500, effort: 'low' },
    })
    adapter.beforeStart({ container: { registerFactory() {}, registerInstance() {} } } as never)

    await adapter.runAgent({ messages: [{ role: 'user', content: 'a' }] })
    await adapter.runAgent({
      messages: [{ role: 'user', content: 'b' }],
      model: 'call-model',
      maxTokens: 10,
    })

    expect(provider.calls[0].input.model).toBe('default-model')
    expect(provider.calls[0].options).toMatchObject({
      temperature: 0.1,
      maxTokens: 500,
      effort: 'low',
    })
    expect(provider.calls[1].input.model).toBe('call-model')
    expect(provider.calls[1].options).toMatchObject({ temperature: 0.1, maxTokens: 10 })
  })
})

describe('AiAdapter — default signal', () => {
  it('uses defaults.signal when the call passes none', async () => {
    const provider = new RecordingProvider()
    const signal = new AbortController().signal
    const adapter = AiAdapter({ provider, defaults: { signal } })
    adapter.beforeStart({ container: { registerFactory() {}, registerInstance() {} } } as never)

    await adapter.runAgent({ messages: [{ role: 'user', content: 'a' }] })
    expect(provider.calls[0].options?.signal).toBe(signal)
  })
})

describe('postJson — abort during retry backoff', () => {
  it('rejects with the abort, not the error being retried', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('slow down', { status: 429 }))
    const controller = new AbortController()
    const pending = postJson(
      'https://api.example/x',
      {},
      {
        signal: controller.signal,
        retry: { maxRetries: 3, baseDelayMs: 60_000, maxDelayMs: 60_000 },
      },
    )
    setTimeout(() => controller.abort(), 10)
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})
