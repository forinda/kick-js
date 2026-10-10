/**
 * A provider's `fetch` option sends every request — chat, stream, embed,
 * retries — and the global `fetch` is never called.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AnthropicProvider, OpenAIProvider, type ChatChunk } from '@forinda/kickjs-ai'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const sse = (events: unknown[]) =>
  new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n', {
    headers: { 'content-type': 'text/event-stream' },
  })

let globalFetch: ReturnType<typeof vi.spyOn>
afterEach(() => vi.restoreAllMocks())

function spyGlobal() {
  globalFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('global fetch used'))
}

describe('OpenAIProvider fetch option', () => {
  it('sends chat, stream, embed and retries through it', async () => {
    spyGlobal()
    const urls: string[] = []
    const responses = [
      json({ error: 'slow down' }, 429),
      json({ choices: [{ message: { content: 'hi' } }] }),
      sse([
        { choices: [{ delta: { content: 'he' } }] },
        { choices: [{ delta: { content: 'y' }, finish_reason: 'stop' }] },
      ]),
      json({ data: [{ embedding: [0.1, 0.2] }] }),
    ]
    const custom = vi.fn(async (url: string | URL | Request) => {
      urls.push(String(url))
      return responses.shift()!
    })
    const provider = new OpenAIProvider({
      apiKey: 'sk-test',
      fetch: custom as typeof fetch,
      retry: { baseDelayMs: 1, maxDelayMs: 5 },
    })

    expect((await provider.chat({ messages: [{ role: 'user', content: 'x' }] })).content).toBe('hi')
    const chunks: ChatChunk[] = []
    for await (const c of provider.stream({ messages: [{ role: 'user', content: 'x' }] }))
      chunks.push(c)
    expect(chunks.map((c) => c.content).join('')).toBe('hey')
    expect(await provider.embed('x')).toEqual([[0.1, 0.2]])

    expect(urls).toEqual([
      'https://api.openai.com/v1/chat/completions', // the 429
      'https://api.openai.com/v1/chat/completions', // its retry
      'https://api.openai.com/v1/chat/completions',
      'https://api.openai.com/v1/embeddings',
    ])
    expect(globalFetch).not.toHaveBeenCalled()
  })

  it('uses the global fetch when none is given, looked up per call', async () => {
    const replaced = vi.fn(async () => json({ choices: [{ message: { content: 'global' } }] }))
    vi.spyOn(globalThis, 'fetch').mockImplementation(replaced as typeof fetch)
    const provider = new OpenAIProvider({ apiKey: 'sk-test' })
    expect((await provider.chat({ messages: [{ role: 'user', content: 'x' }] })).content).toBe(
      'global',
    )
    expect(replaced).toHaveBeenCalledOnce()
  })
})

describe('AnthropicProvider fetch option', () => {
  it('hands it to the SDK client it creates', async () => {
    spyGlobal()
    const custom = vi.fn(async () =>
      json({ type: 'error', error: { type: 'invalid_request_error', message: 'stop here' } }, 400),
    )
    const provider = new AnthropicProvider({ apiKey: 'sk-test', fetch: custom as typeof fetch })
    await expect(provider.chat({ messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow()
    expect(custom).toHaveBeenCalled()
    expect(String((custom.mock.calls[0] as unknown[])[0])).toContain('/v1/messages')
    expect(globalFetch).not.toHaveBeenCalled()
  })
})
