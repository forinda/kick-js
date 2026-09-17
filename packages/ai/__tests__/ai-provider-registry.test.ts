/**
 * Mounting extra AI providers after the adapter is created, and picking one
 * per call.
 */
import 'reflect-metadata'
import { describe, expect, it } from 'vitest'
import { AiAdapter, InMemoryChatMemory } from '@forinda/kickjs-ai'
import type { AiProvider, ChatResponse } from '@forinda/kickjs-ai'

function provider(name: string): AiProvider & { calls: number } {
  return {
    name,
    calls: 0,
    async chat(): Promise<ChatResponse> {
      this.calls++
      return { content: `from ${name}`, finishReason: 'stop' }
    },
    // eslint-disable-next-line require-yield
    async *stream() {
      throw new Error('not used')
    },
    async embed() {
      return []
    },
  }
}

function adapterWith(defaultProvider: AiProvider) {
  const adapter = AiAdapter({ provider: defaultProvider })
  adapter.beforeStart({ container: { registerFactory() {}, registerInstance() {} } } as never)
  return adapter
}

const ask = [{ role: 'user' as const, content: 'hi' }]

describe('AiAdapter — provider registry', () => {
  it('runs a call on a registered provider by name, leaving the default in place', async () => {
    const openai = provider('openai')
    const claude = provider('claude')
    const adapter = adapterWith(openai)

    adapter.registerProvider('claude', claude)

    expect((await adapter.runAgent({ messages: ask, provider: 'claude' })).content).toBe(
      'from claude',
    )
    expect((await adapter.runAgent({ messages: ask })).content).toBe('from openai')
    expect(adapter.getProvider('claude')).toBe(claude)
    expect(adapter.getProvider()).toBe(openai)
  })

  it('accepts a provider instance per call without registering it', async () => {
    const adapter = adapterWith(provider('openai'))
    const local = provider('local')
    await adapter.runAgent({ messages: ask, provider: local })
    expect(local.calls).toBe(1)
  })

  it('names the registered providers when an unknown one is requested', async () => {
    const adapter = adapterWith(provider('openai'))
    adapter.registerProvider('claude', provider('claude'))
    await expect(adapter.runAgent({ messages: ask, provider: 'gemini' })).rejects.toThrow(
      'no provider registered as "gemini". Registered: openai, claude',
    )
  })

  it('replaces a provider registered under the same name, but protects the default', () => {
    const openai = provider('openai')
    const adapter = adapterWith(openai)
    const first = provider('claude')
    const second = provider('claude')

    adapter.registerProvider('claude', first)
    adapter.registerProvider('claude', second)
    expect(adapter.getProvider('claude')).toBe(second)

    expect(() => adapter.registerProvider('openai', provider('openai'))).toThrow(/default provider/)
    expect(adapter.unregisterProvider('openai')).toBe(false)
    expect(adapter.unregisterProvider('claude')).toBe(true)
    expect(() => adapter.getProvider('claude')).toThrow(/no provider registered/)
  })

  it('runAgentWithMemory uses the selected provider', async () => {
    const adapter = adapterWith(provider('openai'))
    adapter.registerProvider('claude', provider('claude'))
    const result = await adapter.runAgentWithMemory({
      memory: new InMemoryChatMemory(),
      userMessage: 'hi',
      provider: 'claude',
    })
    expect(result.content).toBe('from claude')
  })
})
