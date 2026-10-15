/**
 * Providers built from settings sections: read on first use (after the app
 * binds them), declared to the app by AiAdapter, validated at startup.
 */
import 'reflect-metadata'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Application, Container, defineSettings } from '@forinda/kickjs'
import { AiAdapter } from '@forinda/kickjs-ai'
import { AnthropicSettings, OpenAISettings, openAIFromSettings } from '../src/settings'

beforeEach(() => Container.reset())
afterEach(() => vi.unstubAllEnvs())

const reply = () =>
  new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }] }), {
    headers: { 'content-type': 'application/json' },
  })

describe('openAIFromSettings', () => {
  it('reads nothing until first use, then the value the app bound', async () => {
    const calls: Array<{ url: string; auth: string | null }> = []
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), auth: new Headers(init?.headers).get('authorization') })
      return reply()
    })
    // No OPENAI_* env at all: building the provider must not throw.
    const provider = openAIFromSettings(OpenAISettings, { fetch: fetch as typeof globalThis.fetch })
    expect(provider.name).toBe('openai')

    const app = new Application({
      modules: [],
      settings: [OpenAISettings.provide({ apiKey: 'sk-provided', baseURL: 'http://llm.test/v1' })],
      adapters: [AiAdapter({ provider })],
    })
    await app.setup()

    const res = await provider.chat({ messages: [{ role: 'user', content: 'x' }] })
    expect(res.content).toBe('hi')
    expect(calls).toEqual([
      { url: 'http://llm.test/v1/chat/completions', auth: 'Bearer sk-provided' },
    ])
  })

  it('is declared by AiAdapter, so a missing key fails startup naming the variable', async () => {
    // Independent of a key in the host's environment.
    vi.stubEnv('OPENAI_API_KEY', '')
    const app = new Application({
      modules: [],
      adapters: [AiAdapter({ provider: openAIFromSettings() })],
    })
    await expect(app.setup()).rejects.toThrow(/OPENAI_API_KEY/)
  })

  it('shows up in describeConfig as declared by the adapter', () => {
    const app = new Application({
      modules: [],
      adapters: [AiAdapter({ provider: openAIFromSettings() })],
    })
    const section = app.describeConfig().sections.find((s) => s.prefix === 'OPENAI')
    expect(section?.declaredBy).toBe('adapter AiAdapter')
    expect(section?.vars.map((v) => v.name)).toContain('OPENAI_API_KEY')
  })

  it('reads a scoped instance from its own prefix', async () => {
    vi.stubEnv('OLLAMA_OPENAI_API_KEY', 'ollama')
    vi.stubEnv('OLLAMA_OPENAI_BASE_URL', 'http://localhost:11434/v1')
    const urls: string[] = []
    const provider = openAIFromSettings(OpenAISettings.scoped('OLLAMA'), {
      name: 'ollama',
      fetch: (async (url: string | URL | Request) => {
        urls.push(String(url))
        return reply()
      }) as typeof globalThis.fetch,
    })
    await new Application({ modules: [], adapters: [AiAdapter({ provider })] }).setup()
    await provider.chat({ messages: [{ role: 'user', content: 'x' }] })
    expect(provider.name).toBe('ollama')
    expect(urls).toEqual(['http://localhost:11434/v1/chat/completions'])
  })
})

describe('the sections need no schema library', () => {
  it('validate env, naming each bad variable', () => {
    expect(() =>
      AnthropicSettings.load({
        ANTHROPIC_BASE_URL: 'not a url',
        ANTHROPIC_DEFAULT_MAX_TOKENS: '1.5',
      }),
    ).toThrow(/ANTHROPIC_BASE_URL: Expected a URL[\s\S]*ANTHROPIC_DEFAULT_MAX_TOKENS/)
    expect(() => OpenAISettings.load({ OPENAI_API_KEY: '' })).toThrow(/OPENAI_API_KEY: Required/)
  })

  it('reject a boolean or decimal where an integer is expected', () => {
    expect(() => AnthropicSettings.parse({ defaultMaxTokens: true })).toThrow(/positive integer/)
    expect(() => AnthropicSettings.parse({ defaultMaxTokens: '1e3' })).toThrow(/positive integer/)
    expect(AnthropicSettings.parse({ defaultMaxTokens: 2048 })).toEqual({ defaultMaxTokens: 2048 })
  })

  it('parse integers and drop unset values', () => {
    expect(AnthropicSettings.load({ ANTHROPIC_DEFAULT_MAX_TOKENS: '8000' })).toEqual({
      defaultMaxTokens: 8000,
    })
  })

  it('describe themselves for .env.example', () => {
    expect(
      OpenAISettings.describe()
        .filter((v) => v.required)
        .map((v) => v.name),
    ).toEqual(['OPENAI_API_KEY'])
  })
})

describe('a section from your own schema', () => {
  it('works with any schema library, prefix and extra fields', async () => {
    const { z } = await import('zod')
    const Llm = defineSettings(
      'LLM',
      z.object({
        apiKey: z.string().startsWith('sk-'),
        baseURL: z.url(),
        defaultChatModel: z.string().default('gpt-4o-mini'),
        budgetCents: z.coerce.number().default(500), // the app's own field
      }),
    )
    vi.stubEnv('LLM_API_KEY', 'sk-custom')
    vi.stubEnv('LLM_BASE_URL', 'http://llm.test/v1')
    let body: { model?: string } = {}
    const provider = openAIFromSettings(Llm, {
      fetch: (async (_url: string | URL | Request, init?: RequestInit) => {
        body = JSON.parse(String(init?.body))
        return reply()
      }) as typeof globalThis.fetch,
    })
    await new Application({ modules: [], adapters: [AiAdapter({ provider })] }).setup()
    await provider.chat({ messages: [{ role: 'user', content: 'x' }] })
    expect(body.model).toBe('gpt-4o-mini')
    expect(Llm.get().budgetCents).toBe(500)
  })

  it('fails startup with the schema’s own rules, naming the variable', async () => {
    const { z } = await import('zod')
    const Llm = defineSettings('LLM2', z.object({ apiKey: z.string().min(20) }))
    vi.stubEnv('LLM2_API_KEY', 'short')
    const app = new Application({
      modules: [],
      adapters: [AiAdapter({ provider: openAIFromSettings(Llm) })],
    })
    await expect(app.setup()).rejects.toThrow(/LLM2_API_KEY/)
  })
})

describe('after a rebuild', () => {
  it('builds the provider again from the newly bound settings', async () => {
    const auth: Array<string | null> = []
    const provider = openAIFromSettings(OpenAISettings, {
      fetch: (async (_url: string | URL | Request, init?: RequestInit) => {
        auth.push(new Headers(init?.headers).get('authorization'))
        return reply()
      }) as typeof globalThis.fetch,
    })
    vi.stubEnv('OPENAI_API_KEY', 'sk-old')
    const app = new Application({ modules: [], adapters: [AiAdapter({ provider })] })
    await app.setup()
    await provider.chat({ messages: [{ role: 'user', content: 'x' }] })

    vi.stubEnv('OPENAI_API_KEY', 'sk-new')
    await app.rebuild()
    await provider.chat({ messages: [{ role: 'user', content: 'x' }] })
    expect(auth).toEqual(['Bearer sk-old', 'Bearer sk-new'])
  })
})
