/**
 * Provider config as settings sections — read from the environment the
 * providers' own SDKs use (`OPENAI_API_KEY`, `ANTHROPIC_BASE_URL`, …),
 * validated when the app starts, and listed by `kick env example`:
 *
 * ```ts
 * import { openAIFromSettings } from '@forinda/kickjs-ai/settings'
 *
 * bootstrap({ modules, adapters: [AiAdapter({ provider: openAIFromSettings() })] })
 * ```
 *
 * A separate entry because it needs a `@forinda/kickjs` with `defineSettings`;
 * the main entry still works with older ones. No schema library needed.
 *
 * @module @forinda/kickjs-ai/settings
 */
import { defineSettings, type Settings, type SettingsOf } from '@forinda/kickjs'
import type { KickSchema, SchemaIssue } from '@forinda/kickjs-schema'
import { PROVIDER_SETTINGS } from './constants'
import { AnthropicProvider, type AnthropicProviderOptions } from './providers/anthropic'
import { OpenAIProvider, type OpenAIProviderOptions } from './providers/openai'
import type { AiProvider } from './types'

interface Field {
  type: 'string' | 'url' | 'integer'
  required?: boolean
  description?: string
}

/**
 * A flat schema for a few env fields, written out instead of taken from a
 * schema library — so this entry works whether the app uses Zod, Valibot,
 * Yup or none. Empty counts as unset; integers are positive.
 */
function fields<T>(spec: Record<string, Field>): KickSchema<T> {
  return {
    safeParse(data) {
      const input = (data ?? {}) as Record<string, unknown>
      const out: Record<string, unknown> = {}
      const issues: SchemaIssue[] = []
      for (const [key, field] of Object.entries(spec)) {
        const raw = input[key]
        if (raw === undefined || raw === '') {
          if (field.required) issues.push({ path: [key], message: 'Required', code: 'required' })
          continue
        }
        if (field.type === 'integer') {
          const n = Number(raw)
          if (Number.isInteger(n) && n > 0) out[key] = n
          else issues.push({ path: [key], message: 'Expected a positive integer', code: 'type' })
          continue
        }
        if (typeof raw !== 'string') {
          issues.push({ path: [key], message: 'Expected a string', code: 'type' })
        } else if (field.type === 'url' && !URL.canParse(raw)) {
          issues.push({ path: [key], message: 'Expected a URL', code: 'format' })
        } else {
          out[key] = raw
        }
      }
      return issues.length > 0 ? { success: false, issues } : { success: true, data: out as T }
    },
    toJsonSchema: () => ({
      type: 'object',
      properties: Object.fromEntries(
        Object.entries(spec).map(([key, field]) => [
          key,
          {
            type: field.type === 'integer' ? 'integer' : 'string',
            ...(field.description ? { description: field.description } : {}),
          },
        ]),
      ),
      required: Object.keys(spec).filter((key) => spec[key].required),
    }),
  }
}

/** `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_DEFAULT_CHAT_MODEL`, … */
export const OpenAISettings = defineSettings(
  'OPENAI',
  fields<{
    apiKey: string
    baseURL?: string
    defaultChatModel?: string
    defaultEmbedModel?: string
    organization?: string
  }>({
    apiKey: { type: 'string', required: true },
    baseURL: { type: 'url', description: 'An OpenAI-compatible endpoint (Ollama, vLLM, Azure)' },
    defaultChatModel: { type: 'string' },
    defaultEmbedModel: { type: 'string' },
    organization: { type: 'string' },
  }),
)

/** `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_DEFAULT_CHAT_MODEL`, … */
export const AnthropicSettings = defineSettings(
  'ANTHROPIC',
  fields<{
    apiKey?: string
    baseURL?: string
    defaultChatModel?: string
    defaultMaxTokens?: number
  }>({
    // Optional: without it the SDK falls back to its own credential lookup.
    apiKey: { type: 'string' },
    baseURL: { type: 'url' },
    defaultChatModel: { type: 'string' },
    defaultMaxTokens: { type: 'integer' },
  }),
)

/**
 * A provider built on first use — after the app has bound its settings, so it
 * sees a value a test supplied with `provide()`, and loading the app (as
 * `kick env example` does) never reads the environment. Carries its section,
 * so `AiAdapter` declares it and the app validates it at startup.
 */
function lazyProvider<T>(
  name: string,
  section: Settings<T>,
  create: (settings: T) => AiProvider,
): AiProvider {
  let provider: AiProvider | undefined
  const real = () => (provider ??= create(section.get()))
  return {
    name,
    [PROVIDER_SETTINGS]: section,
    chat: (input, options) => real().chat(input, options),
    stream: (input, options) => real().stream(input, options),
    embed: (input, options) => real().embed(input, options),
  } as AiProvider
}

/**
 * An `OpenAIProvider` configured from {@link OpenAISettings} — or another
 * instance, `OpenAISettings.scoped('OLLAMA')`. `options` adds what env can't
 * carry (`retry`, `fetch`, `name`); a variable that is set wins over it.
 */
export function openAIFromSettings(
  section: Settings<SettingsOf<typeof OpenAISettings>> = OpenAISettings,
  options: Partial<OpenAIProviderOptions> = {},
): AiProvider {
  return lazyProvider(
    options.name ?? 'openai',
    section,
    (settings) => new OpenAIProvider({ ...options, ...settings }),
  )
}

/** An `AnthropicProvider` configured from {@link AnthropicSettings}; see {@link openAIFromSettings}. */
export function anthropicFromSettings(
  section: Settings<SettingsOf<typeof AnthropicSettings>> = AnthropicSettings,
  options: AnthropicProviderOptions = {},
): AiProvider {
  return lazyProvider(
    options.name ?? 'anthropic',
    section,
    (settings) => new AnthropicProvider({ ...options, ...settings }),
  )
}
