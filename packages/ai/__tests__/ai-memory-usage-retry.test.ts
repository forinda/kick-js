/**
 * runAgentWithMemory passes every runAgent option and saves nothing from a
 * failed turn; usage keeps cache tokens; SlidingWindowChatMemory serializes
 * writes; RagService.index embeds in batches; retries give up on a long
 * Retry-After and surface an abort.
 */
import 'reflect-metadata'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Application, Container } from '@forinda/kickjs'
import {
  AiAdapter,
  InMemoryChatMemory,
  InMemoryVectorStore,
  OpenAIProvider,
  ProviderError,
  RagService,
  ScriptedProvider,
  SlidingWindowChatMemory,
} from '@forinda/kickjs-ai'
import type { AiProvider } from '@forinda/kickjs-ai'

const apps: Application[] = []
beforeEach(() => Container.reset())
afterEach(async () => {
  vi.restoreAllMocks()
  while (apps.length) await apps.pop()!.shutdown()
})

async function start(provider: AiProvider) {
  const adapter = AiAdapter({ provider })
  const app = new Application({ modules: [], adapters: [adapter] } as never)
  apps.push(app)
  await app.startWithoutServer()
  return adapter
}

describe('runAgentWithMemory', () => {
  it('passes effort and other runAgent options to the provider', async () => {
    const provider = new ScriptedProvider([{ content: 'hi', finishReason: 'stop' }])
    const ai = await start(provider)
    await ai.runAgentWithMemory({
      memory: new InMemoryChatMemory(),
      userMessage: 'hello',
      effort: 'low',
      tools: [],
    })
    expect(provider.chatOptions[0].effort).toBe('low')
  })

  it('saves the system prompt, user turn and reply together after a run', async () => {
    const provider = new ScriptedProvider([{ content: 'hi', finishReason: 'stop' }])
    const ai = await start(provider)
    const memory = new InMemoryChatMemory()
    await ai.runAgentWithMemory({ memory, userMessage: 'hello', systemPrompt: 'be brief' })
    expect((await memory.get()).map((m) => m.role)).toEqual(['system', 'user', 'assistant'])
  })

  it('leaves memory untouched when the run fails', async () => {
    const ai = await start(new ScriptedProvider([]))
    const memory = new InMemoryChatMemory()
    await expect(
      ai.runAgentWithMemory({ memory, userMessage: 'hello', systemPrompt: 'be brief' }),
    ).rejects.toThrow(/no scripted turn left/)
    expect(await memory.get()).toEqual([])
  })
})

describe('usage', () => {
  it('sums cache tokens across steps', async () => {
    const usage = {
      promptTokens: 10,
      completionTokens: 2,
      totalTokens: 12,
      cacheReadTokens: 8,
      cacheWriteTokens: 1,
    }
    const provider = new ScriptedProvider([
      { content: '', toolCalls: [{ id: 'c1', name: 'missing', arguments: {} }], usage },
      { content: 'done', finishReason: 'stop', usage },
    ])
    const ai = await start(provider)
    const result = await ai.runAgent({ messages: [{ role: 'user', content: 'go' }], tools: [] })
    expect(result.usage).toEqual({
      promptTokens: 20,
      completionTokens: 4,
      totalTokens: 24,
      cacheReadTokens: 16,
      cacheWriteTokens: 2,
    })
  })
})

describe('SlidingWindowChatMemory', () => {
  it('keeps every message from concurrent adds', async () => {
    const memory = new SlidingWindowChatMemory({ inner: new InMemoryChatMemory(), maxMessages: 4 })
    await memory.add([
      { role: 'user', content: '1' },
      { role: 'assistant', content: '1' },
      { role: 'user', content: '2' },
      { role: 'assistant', content: '2' },
    ])
    await Promise.all([
      memory.add([
        { role: 'user', content: '3' },
        { role: 'assistant', content: '3' },
      ]),
      memory.add([
        { role: 'user', content: '4' },
        { role: 'assistant', content: '4' },
      ]),
    ])
    expect((await memory.get()).map((m) => m.content)).toEqual(['3', '3', '4', '4'])
  })
})

describe('RagService.index', () => {
  it('embeds in batches', async () => {
    const sizes: number[] = []
    const provider = new ScriptedProvider([], {
      embed: (texts) => {
        sizes.push(texts.length)
        return texts.map(() => [1, 0])
      },
    })
    const store = new InMemoryVectorStore()
    const rag = new RagService(provider, store)
    const docs = Array.from({ length: 5 }, (_, i) => ({ id: String(i), content: `doc ${i}` }))
    await rag.index(docs, { batchSize: 2 })
    expect(sizes).toEqual([2, 2, 1])
    expect(await store.count?.()).toBe(5)
  })
})

describe('retries', () => {
  const provider = () =>
    new OpenAIProvider({ apiKey: 'k', retry: { maxRetries: 3, maxDelayMs: 1000 } })

  it('throws at once when Retry-After is longer than maxDelayMs', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response('slow down', { status: 429, headers: { 'retry-after': '120' } }),
      )
    await expect(
      provider().chat({ messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toBeInstanceOf(ProviderError)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('honours retry: { maxRetries: 0 }', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('down', { status: 503 }))
    const p = new OpenAIProvider({ apiKey: 'k', retry: { maxRetries: 0 } })
    await expect(p.chat({ messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('a stream aborted while waiting to retry throws the abort reason', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('down', { status: 503 }))
    const controller = new AbortController()
    const reason = new Error('stopped')
    setTimeout(() => controller.abort(reason), 20)
    const consume = async () => {
      for await (const _ of provider().stream(
        { messages: [{ role: 'user', content: 'x' }] },
        { signal: controller.signal },
      ));
    }
    await expect(consume()).rejects.toBe(reason)
  })

  it('passes the signal to embed', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({ data: [{ index: 0, embedding: [1] }] }))
    const signal = new AbortController().signal
    await provider().embed('x', { signal })
    expect(fetch.mock.calls[0][1]?.signal).toBe(signal)
  })
})
