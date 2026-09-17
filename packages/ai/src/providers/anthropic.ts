import type Anthropic from '@anthropic-ai/sdk'
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import type {
  AiProvider,
  ChatChunk,
  ChatInput,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  ChatUsage,
  EmbedInput,
} from '../types'
import { ProviderError } from './base'

type BetaMessage = Anthropic.Beta.Messages.BetaMessage
type BetaMessageParam = Anthropic.Beta.Messages.BetaMessageParam
type BetaContentBlockParam = Anthropic.Beta.Messages.BetaContentBlockParam
type BetaToolResultBlockParam = Anthropic.Beta.Messages.BetaToolResultBlockParam
type StreamParams = BetaMessageStreamParams

/** Effort levels accepted by `output_config.effort`. */
export type AnthropicEffort = NonNullable<ChatOptions['effort']>

/**
 * Configuration for the Anthropic provider.
 *
 * Uses the official `@anthropic-ai/sdk` (an optional peer dependency —
 * install it alongside `@forinda/kickjs-ai`). The SDK is loaded on first use,
 * so importing this package never requires it.
 */
export interface AnthropicProviderOptions {
  /**
   * API key. When omitted, the SDK resolves credentials itself:
   * `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, or an `ant auth login` profile.
   */
  apiKey?: string
  /** Override base URL (a proxy or gateway). Defaults to the SDK's. */
  baseURL?: string
  /**
   * A pre-configured SDK client, used instead of constructing one — for
   * custom retries or timeouts, or a platform client such as Bedrock or
   * Vertex (set `fallbacks: false` there; they don't support it).
   */
  client?: Anthropic
  /** Default model when `ChatInput.model` is not set. Defaults to `'claude-opus-5'`. */
  defaultChatModel?: string
  /**
   * Default `max_tokens` — a cap on thinking plus response text. Requests
   * always stream, so a large value is safe. Defaults to 64000.
   */
  defaultMaxTokens?: number
  /** Default effort for every call; `ChatOptions.effort` overrides it. */
  effort?: AnthropicEffort
  /**
   * Return a readable summary of the model's thinking (`'summarized'`) or
   * nothing (`'omitted'`, the API default on current models). Thinking
   * happens and is billed either way.
   */
  thinkingDisplay?: 'summarized' | 'omitted'
  /**
   * Automatic prompt caching (`cache_control` on the request): the tools,
   * system prompt and history of an agent loop are read from cache on the
   * next step. Defaults to `true`.
   */
  cache?: boolean
  /**
   * Server-side fallback when the model declines a request: `'default'`
   * re-runs it on Anthropic's recommended fallback model for the refusal's
   * category, inside the same call. Applied to Claude Opus 5 and Fable/Mythos
   * 5 models, where it defaults to `'default'`; `false` turns it off. Not
   * available on Bedrock, Vertex or Foundry.
   */
  fallbacks?: 'default' | false
  /** Provider name override. Defaults to `'anthropic'`. */
  name?: string
}

/** Models whose safety classifiers can decline a request, and that support `fallbacks`. */
const FALLBACK_MODELS = /^claude-(opus-5|fable-5|mythos-5)/
/** Models that reject `temperature` / `top_p` with a 400. */
const NO_SAMPLING_MODELS = /^claude-(opus-5|opus-4-7|opus-4-8|sonnet-5|fable|mythos)/

const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

/**
 * Built-in Anthropic provider, on the official SDK.
 *
 * Translates the framework's `ChatInput` to Claude's Messages API and back:
 *
 * - **System messages** go to the top-level `system` field, joined in order.
 * - **Tool results** from consecutive `tool` messages go back in one user
 *   message, failed calls marked `is_error`, so the model keeps making
 *   parallel calls.
 * - **Thinking blocks** are returned on `ChatResponse.providerContent` and
 *   sent back verbatim with the assistant turn that carries them — tool loops
 *   on thinking models need them. `AiAdapter.runAgent` does this for you.
 * - **Stop reasons** are normalized (`end_turn` → `stop`, `max_tokens` →
 *   `length`, `tool_use` → `tool_call`, `refusal` → `content_filter` with
 *   `ChatResponse.refusal`).
 * - **Sampling parameters** are dropped, with a warning, for models that
 *   reject them.
 *
 * Every request streams (`chat()` collects the final message), so large
 * `max_tokens` values don't hit HTTP timeouts. API errors are rethrown as
 * `ProviderError` with the HTTP status, including errors that arrive mid-stream.
 *
 * Anthropic has no embeddings API; `embed()` throws.
 *
 * @example
 * ```ts
 * import { bootstrap } from '@forinda/kickjs'
 * import { AiAdapter, AnthropicProvider } from '@forinda/kickjs-ai'
 *
 * export const app = await bootstrap({
 *   modules,
 *   adapters: [AiAdapter({ provider: new AnthropicProvider({ effort: 'medium' }) })],
 * })
 * ```
 */
export class AnthropicProvider implements AiProvider {
  readonly name: string

  private readonly defaultChatModel: string
  private readonly defaultMaxTokens: number
  private clientPromise?: Promise<Anthropic>
  private readonly warned = new Set<string>()

  constructor(private readonly options: AnthropicProviderOptions = {}) {
    this.defaultChatModel = options.defaultChatModel ?? 'claude-opus-5'
    this.defaultMaxTokens = options.defaultMaxTokens ?? 64000
    this.name = options.name ?? 'anthropic'
  }

  async chat(input: ChatInput, options: ChatOptions = {}): Promise<ChatResponse> {
    const client = await this.client()
    try {
      const stream = client.beta.messages.stream(this.buildParams(input, options, false), {
        signal: options.signal,
      })
      return this.normalize(await stream.finalMessage())
    } catch (err) {
      throw toProviderError(err)
    }
  }

  async *stream(input: ChatInput, options: ChatOptions = {}): AsyncIterable<ChatChunk> {
    const client = await this.client()
    const toolIds = new Map<number, string>()
    try {
      const stream = client.beta.messages.stream(this.buildParams(input, options, true), {
        signal: options.signal,
      })
      for await (const event of stream) {
        if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
          toolIds.set(event.index, event.content_block.id)
          yield {
            content: '',
            done: false,
            toolCallDelta: {
              id: event.content_block.id,
              index: event.index,
              name: event.content_block.name,
            },
          }
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            yield { content: event.delta.text, done: false }
          } else if (event.delta.type === 'input_json_delta') {
            yield {
              content: '',
              done: false,
              toolCallDelta: {
                id: toolIds.get(event.index) ?? '',
                index: event.index,
                argumentsDelta: event.delta.partial_json,
              },
            }
          }
        }
      }
      // An `error` event mid-stream rejects here, instead of ending quietly.
      const final = this.normalize(await stream.finalMessage())
      yield { content: '', done: true, finishReason: final.finishReason, usage: final.usage }
    } catch (err) {
      throw toProviderError(err)
    }
  }

  async embed(_input: EmbedInput): Promise<number[][]> {
    throw new Error(
      'AnthropicProvider.embed is not available — Anthropic does not provide an embeddings API. ' +
        'Use OpenAIProvider (or another embeddings-capable provider) for embed calls, ' +
        'and keep Anthropic for chat.',
    )
  }

  // ── Internal ──────────────────────────────────────────────────────────

  private client(): Promise<Anthropic> {
    if (this.options.client) return Promise.resolve(this.options.client)
    this.clientPromise ??= import('@anthropic-ai/sdk').then(
      (mod) =>
        new mod.default({
          ...(this.options.apiKey ? { apiKey: this.options.apiKey } : {}),
          ...(this.options.baseURL ? { baseURL: this.options.baseURL } : {}),
        }),
      (err) => {
        this.clientPromise = undefined
        throw new Error(
          'AnthropicProvider needs the @anthropic-ai/sdk package. Install it: pnpm add @anthropic-ai/sdk',
          { cause: err },
        )
      },
    )
    return this.clientPromise
  }

  private buildParams(
    input: ChatInput,
    options: ChatOptions,
    eagerToolInput: boolean,
  ): StreamParams {
    const model = input.model ?? this.defaultChatModel
    const system = input.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n')

    const params: StreamParams = {
      model,
      max_tokens: options.maxTokens ?? this.defaultMaxTokens,
      messages: toAnthropicMessages(input.messages),
    }
    if (system) params.system = system
    if (options.stopSequences?.length) params.stop_sequences = options.stopSequences
    if (this.options.cache !== false) params.cache_control = { type: 'ephemeral' }

    const effort = options.effort ?? this.options.effort
    if (effort) params.output_config = { effort }
    if (this.options.thinkingDisplay) {
      params.thinking = { type: 'adaptive', display: this.options.thinkingDisplay }
    }

    if (NO_SAMPLING_MODELS.test(model)) {
      if (options.temperature !== undefined || options.topP !== undefined) {
        this.warnOnce(
          `sampling:${model}`,
          `AnthropicProvider: ${model} does not accept temperature/topP; they were not sent. Use effort instead.`,
        )
      }
    } else if (options.temperature !== undefined) {
      // Claude 4.x accepts one of temperature / top_p, not both.
      params.temperature = options.temperature
    } else if (options.topP !== undefined) {
      params.top_p = options.topP
    }

    if (Array.isArray(input.tools) && input.tools.length > 0) {
      params.tools = input.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema as Anthropic.Beta.Messages.BetaTool.InputSchema,
        // Streamed callers see tool arguments as they are generated. The
        // arguments are not validated server-side then; AiAdapter's tool
        // routes validate them, and truncated calls are caught by the
        // `length` finish reason.
        ...(eagerToolInput ? { eager_input_streaming: true } : {}),
      }))
    }

    if (FALLBACK_MODELS.test(model) && this.options.fallbacks !== false) {
      params.fallbacks = 'default'
      params.betas = [FALLBACK_BETA]
    }
    return params
  }

  private normalize(message: BetaMessage): ChatResponse {
    const text: string[] = []
    const toolCalls: NonNullable<ChatResponse['toolCalls']> = []
    let needsReplay = false

    for (const block of message.content) {
      if (block.type === 'text') text.push(block.text)
      else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments:
            block.input && typeof block.input === 'object'
              ? (block.input as Record<string, unknown>)
              : {},
        })
      } else {
        // thinking, fallback and other blocks must go back with this turn.
        needsReplay = true
      }
    }

    const result: ChatResponse = { content: text.join('') }
    if (toolCalls.length > 0) result.toolCalls = toolCalls
    if (needsReplay) result.providerContent = message.content

    const usage = message.usage
    const cacheRead = usage.cache_read_input_tokens ?? 0
    const cacheWrite = usage.cache_creation_input_tokens ?? 0
    const promptTokens = usage.input_tokens + cacheRead + cacheWrite
    const chatUsage: ChatUsage = {
      promptTokens,
      completionTokens: usage.output_tokens,
      totalTokens: promptTokens + usage.output_tokens,
    }
    if (cacheRead) chatUsage.cacheReadTokens = cacheRead
    if (cacheWrite) chatUsage.cacheWriteTokens = cacheWrite
    result.usage = chatUsage

    switch (message.stop_reason) {
      case 'end_turn':
      case 'stop_sequence':
        result.finishReason = 'stop'
        break
      case 'max_tokens':
      case 'model_context_window_exceeded':
        result.finishReason = 'length'
        break
      case 'tool_use':
        result.finishReason = 'tool_call'
        break
      case 'refusal':
        result.finishReason = 'content_filter'
        result.refusal = {
          category: message.stop_details?.category ?? null,
          explanation: message.stop_details?.explanation ?? null,
        }
        break
      default:
        if (message.stop_reason) result.finishReason = message.stop_reason
    }
    return result
  }

  private warnOnce(key: string, text: string): void {
    if (this.warned.has(key)) return
    this.warned.add(key)
    console.warn(text)
  }
}

/**
 * Framework messages → Messages API messages. System messages are handled by
 * the caller; consecutive tool results become one user message.
 */
function toAnthropicMessages(messages: ChatMessage[]): BetaMessageParam[] {
  const out: BetaMessageParam[] = []
  for (const m of messages) {
    if (m.role === 'system') continue

    if (m.role === 'tool') {
      const result: BetaToolResultBlockParam = {
        type: 'tool_result',
        tool_use_id: m.toolCallId ?? '',
        content: m.content,
        ...(m.isError ? { is_error: true } : {}),
      }
      const previous = out.at(-1)
      if (
        previous?.role === 'user' &&
        Array.isArray(previous.content) &&
        previous.content.every((block) => block.type === 'tool_result')
      ) {
        previous.content.push(result)
      } else {
        out.push({ role: 'user', content: [result] })
      }
      continue
    }

    if (m.role === 'assistant') {
      if (Array.isArray(m.providerContent)) {
        out.push({ role: 'assistant', content: m.providerContent as BetaContentBlockParam[] })
        continue
      }
      const blocks: BetaContentBlockParam[] = []
      if (m.content) blocks.push({ type: 'text', text: m.content })
      for (const call of m.toolCalls ?? []) {
        blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments })
      }
      out.push({ role: 'assistant', content: blocks })
      continue
    }

    out.push({ role: 'user', content: [{ type: 'text', text: m.content }] })
  }
  return out
}

/** SDK API errors → ProviderError (status + body); anything else unchanged. */
function toProviderError(err: unknown): unknown {
  if (err instanceof ProviderError) return err
  const status = (err as { status?: unknown })?.status
  if (typeof status === 'number') {
    const body = (err as { error?: unknown }).error
    return new ProviderError(
      status,
      body === undefined ? '' : JSON.stringify(body),
      (err as Error).message,
    )
  }
  return err
}
