import type {
  AiProvider,
  ChatChunk,
  ChatInput,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  EmbedInput,
} from '../types'
import { postJson, postJsonStream } from './base'

/**
 * Configuration for the Anthropic provider.
 *
 * The base URL is configurable so the same class can target an
 * Anthropic-compatible proxy, an internal gateway that adds auth
 * headers, or an air-gapped deployment. The provider only assumes
 * Anthropic's Messages API wire shape, not the hostname.
 */
export interface AnthropicProviderOptions {
  /** API key sent as `x-api-key`. Required. */
  apiKey: string
  /** Override base URL. Defaults to `https://api.anthropic.com/v1`. */
  baseURL?: string
  /** Default chat model used when `ChatInput.model` is not set. */
  defaultChatModel?: string
  /** Anthropic API version header. Defaults to `'2023-06-01'`. */
  apiVersion?: string
  /**
   * Default `max_tokens` for responses. Anthropic requires an explicit
   * max_tokens on every request; the framework's ChatOptions.maxTokens
   * takes precedence when set, but this supplies a fallback so callers
   * don't have to set it every time.
   */
  defaultMaxTokens?: number
  /** Provider name override. Defaults to `'anthropic'`. */
  name?: string
}

/**
 * Built-in Anthropic provider.
 *
 * Implements the framework's `AiProvider` interface using Anthropic's
 * Messages API (`/v1/messages`). Translates the normalized
 * `ChatInput` shape to and from Anthropic's content-block format,
 * including tool calling and streaming.
 *
 * ### Differences from OpenAI
 *
 * Anthropic's API has a few quirks the provider translates away:
 *
 * - **System prompt is separated.** The framework puts system
 *   messages in the `messages` array; Anthropic wants them in a
 *   top-level `system` field. The provider extracts the first system
 *   message and filters out any others.
 * - **Content is always a block array.** Even simple text replies
 *   are wrapped in `[{ type: 'text', text: '...' }]`. The provider
 *   flattens text blocks to a single string on the response.
 * - **Tool calls use `tool_use` content blocks, not a separate
 *   `tool_calls` field.** Normalization pulls them out of the
 *   response content and into `ChatResponse.toolCalls`.
 * - **Tool results are `user` messages with `tool_result` content
 *   blocks**, not a `'tool'` role. The provider handles the
 *   translation both ways.
 * - **`max_tokens` is required on every request.** Framework
 *   `ChatOptions.maxTokens` wins; otherwise falls back to
 *   `defaultMaxTokens` (default 4096).
 *
 * ### Embeddings
 *
 * Anthropic does not ship an embeddings API. Calling `embed()` on
 * this provider throws a descriptive error — users who need
 * embeddings should construct a separate provider (OpenAI's
 * `text-embedding-3-small` is a good default) and bind it
 * alongside the Anthropic chat provider.
 *
 * @example
 * ```ts
 * import { bootstrap, getEnv } from '@forinda/kickjs'
 * import { AiAdapter, AnthropicProvider } from '@forinda/kickjs-ai'
 *
 * export const app = await bootstrap({
 *   modules,
 *   adapters: [
 *     AiAdapter({
 *       provider: new AnthropicProvider({
 *         apiKey: getEnv('ANTHROPIC_API_KEY'),
 *         defaultChatModel: 'claude-opus-4-6',
 *       }),
 *     }),
 *   ],
 * })
 * ```
 */
export class AnthropicProvider implements AiProvider {
  readonly name: string

  private readonly baseURL: string
  private readonly defaultChatModel: string
  private readonly defaultMaxTokens: number
  private readonly headers: Record<string, string>

  constructor(options: AnthropicProviderOptions) {
    if (!options.apiKey) {
      throw new Error('AnthropicProvider: apiKey is required')
    }
    this.baseURL = (options.baseURL ?? 'https://api.anthropic.com/v1').replace(/\/$/, '')
    this.defaultChatModel = options.defaultChatModel ?? 'claude-opus-4-6'
    this.defaultMaxTokens = options.defaultMaxTokens ?? 4096
    this.name = options.name ?? 'anthropic'
    this.headers = {
      'x-api-key': options.apiKey,
      'anthropic-version': options.apiVersion ?? '2023-06-01',
    }
  }

  /**
   * Non-streaming chat completion.
   *
   * Builds the Anthropic Messages payload, posts it, and normalizes
   * the response back to the framework's `ChatResponse` shape.
   */
  async chat(input: ChatInput, options: ChatOptions = {}): Promise<ChatResponse> {
    const payload = this.buildMessagesPayload(input, options, /* stream */ false)
    const data = await postJson<AnthropicMessagesResponse>(`${this.baseURL}/messages`, payload, {
      headers: this.headers,
      signal: options.signal,
    })
    return this.normalizeResponse(data)
  }

  /**
   * Streaming chat completion. Yields `ChatChunk`s as Anthropic
   * events arrive and emits a final chunk with `done: true` after
   * the `message_stop` event.
   *
   * Anthropic's SSE stream uses distinct event types instead of the
   * single-channel deltas OpenAI sends:
   *
   *   - `message_start` — session init, carries model + id
   *   - `content_block_start` — new text or tool_use block begins
   *   - `content_block_delta` — incremental text or partial tool JSON
   *   - `content_block_stop` — block complete
   *   - `message_delta` — stop_reason + final usage
   *   - `message_stop` — end of stream
   *
   * The provider cares about text deltas (for streaming content) and
   * input_json deltas (for tool call argument streaming). Everything
   * else is noise for our purposes and gets filtered.
   */
  async *stream(input: ChatInput, options: ChatOptions = {}): AsyncIterable<ChatChunk> {
    const payload = this.buildMessagesPayload(input, options, /* stream */ true)
    const events = postJsonStream(`${this.baseURL}/messages`, payload, {
      headers: this.headers,
      signal: options.signal,
    })

    // Track the current tool block index + id so tool argument
    // deltas can be routed to the right `toolCallDelta` payload.
    let currentToolBlock: { id: string; name: string } | null = null
    let sawAnyChunk = false

    for await (const raw of events) {
      let parsed: AnthropicStreamEvent
      try {
        parsed = JSON.parse(raw) as AnthropicStreamEvent
      } catch {
        // Malformed chunk — skip rather than crashing the stream.
        continue
      }

      if (parsed.type === 'content_block_start') {
        const block = parsed.content_block
        if (block?.type === 'tool_use') {
          currentToolBlock = { id: block.id ?? '', name: block.name ?? '' }
          sawAnyChunk = true
          yield {
            content: '',
            done: false,
            toolCallDelta: { id: currentToolBlock.id, name: currentToolBlock.name },
          }
        }
        continue
      }

      if (parsed.type === 'content_block_delta') {
        const delta = parsed.delta
        if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
          sawAnyChunk = true
          yield { content: delta.text, done: false }
          continue
        }
        if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
          if (!currentToolBlock) continue
          sawAnyChunk = true
          yield {
            content: '',
            done: false,
            toolCallDelta: {
              id: currentToolBlock.id,
              argumentsDelta: delta.partial_json,
            },
          }
          continue
        }
        continue
      }

      if (parsed.type === 'content_block_stop') {
        currentToolBlock = null
        continue
      }

      if (parsed.type === 'message_stop') {
        yield { content: '', done: true }
        return
      }
    }

    // Stream closed without an explicit message_stop — still emit a
    // terminating chunk so consumers know to stop reading.
    if (sawAnyChunk) {
      yield { content: '', done: true }
    }
  }

  /**
   * Anthropic does not ship an embeddings API. Throws a descriptive
   * error rather than silently returning an empty vector — embedding
   * workflows should use a dedicated provider (OpenAI text-embedding-3-*
   * is the common pick) and bind it alongside this one in the
   * `AI_PROVIDER` token registry if needed.
   */
  async embed(_input: EmbedInput): Promise<number[][]> {
    throw new Error(
      'AnthropicProvider.embed is not available — Anthropic does not provide an embeddings API. ' +
        'Use OpenAIProvider (or another embeddings-capable provider) for embed calls, ' +
        'and keep Anthropic for chat.',
    )
  }

  // ── Internal: payload construction ──────────────────────────────────

  private buildMessagesPayload(
    input: ChatInput,
    options: ChatOptions,
    stream: boolean,
  ): AnthropicMessagesRequest {
    const { systemPrompt, messages } = this.splitSystemMessage(input.messages)

    const payload: AnthropicMessagesRequest = {
      model: input.model ?? this.defaultChatModel,
      max_tokens: options.maxTokens ?? this.defaultMaxTokens,
      messages: messages.map((m) => this.toAnthropicMessage(m)),
    }
    if (systemPrompt) payload.system = systemPrompt
    if (options.temperature !== undefined) payload.temperature = options.temperature
    if (options.topP !== undefined) payload.top_p = options.topP
    if (options.stopSequences && options.stopSequences.length > 0) {
      payload.stop_sequences = options.stopSequences
    }
    if (stream) payload.stream = true

    if (Array.isArray(input.tools) && input.tools.length > 0) {
      payload.tools = input.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      }))
    }

    return payload
  }

  /**
   * Extract the first system message from the framework's messages
   * array and return it separately — Anthropic puts system prompts
   * in a top-level `system` field, not in `messages`. Any additional
   * system messages are dropped on the grounds that models handle
   * one persona prompt per call and concatenating them silently
   * would produce confusing behavior.
   */
  private splitSystemMessage(messages: ChatMessage[]): {
    systemPrompt: string | null
    messages: ChatMessage[]
  } {
    let systemPrompt: string | null = null
    const rest: ChatMessage[] = []
    for (const m of messages) {
      if (m.role === 'system') {
        systemPrompt ??= m.content
        continue
      }
      rest.push(m)
    }
    return { systemPrompt, messages: rest }
  }

  /**
   * Translate a framework `ChatMessage` to Anthropic's wire format.
   *
   * User and plain assistant messages become content blocks with a
   * single `text` entry. Assistant messages with tool calls become
   * a block list mixing `text` and `tool_use` entries. Framework
   * `'tool'` role messages become Anthropic `'user'` messages with
   * a `tool_result` block — that's how Anthropic represents tool
   * call responses.
   */
  private toAnthropicMessage(m: ChatMessage): AnthropicMessage {
    if (m.role === 'tool') {
      return {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: m.toolCallId ?? '',
            content: m.content,
          },
        ],
      }
    }

    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      const blocks: AnthropicContentBlock[] = []
      if (m.content) {
        blocks.push({ type: 'text', text: m.content })
      }
      for (const tc of m.toolCalls) {
        blocks.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.name,
          input: tc.arguments,
        })
      }
      return { role: 'assistant', content: blocks }
    }

    // user or plain assistant
    return {
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: [{ type: 'text', text: m.content }],
    }
  }

  /**
   * Normalize an Anthropic response back to the framework's
   * `ChatResponse`. Flattens text content blocks into a single
   * string and pulls `tool_use` blocks out into `toolCalls`.
   */
  private normalizeResponse(data: AnthropicMessagesResponse): ChatResponse {
    const blocks = data.content ?? []
    const textParts: string[] = []
    const toolCalls: NonNullable<ChatResponse['toolCalls']> = []

    for (const block of blocks) {
      if (block.type === 'text' && typeof block.text === 'string') {
        textParts.push(block.text)
      }
      if (block.type === 'tool_use' && block.name && block.id) {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments:
            block.input && typeof block.input === 'object'
              ? (block.input as Record<string, unknown>)
              : {},
        })
      }
    }

    const result: ChatResponse = { content: textParts.join('') }
    if (toolCalls.length > 0) result.toolCalls = toolCalls
    if (data.usage) {
      result.usage = {
        promptTokens: data.usage.input_tokens,
        completionTokens: data.usage.output_tokens,
        totalTokens: data.usage.input_tokens + data.usage.output_tokens,
      }
    }
    if (data.stop_reason) result.finishReason = data.stop_reason
    return result
  }
}

// ── Anthropic wire types ──────────────────────────────────────────────────
//
// Narrowed to the fields we actually consume. Anthropic's full API
// surface is richer — vision, document inputs, extended thinking,
// prompt caching — but the provider only commits to what it uses.

interface AnthropicMessagesRequest {
  model: string
  max_tokens: number
  messages: AnthropicMessage[]
  system?: string
  temperature?: number
  top_p?: number
  stop_sequences?: string[]
  stream?: boolean
  tools?: Array<{
    name: string
    description: string
    input_schema: Record<string, unknown>
  }>
}

interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: AnthropicContentBlock[]
}

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string }

interface AnthropicMessagesResponse {
  id?: string
  type?: string
  role?: string
  content?: Array<{
    type: 'text' | 'tool_use'
    text?: string
    id?: string
    name?: string
    input?: unknown
  }>
  stop_reason?: string
  usage?: {
    input_tokens: number
    output_tokens: number
  }
}

/**
 * Anthropic streaming event shapes. Each event arrives as a JSON
 * object on its own `data: ` line. We only care about a handful:
 * start / delta / stop for content blocks, and the final message_stop.
 */
type AnthropicStreamEvent =
  | {
      type: 'message_start'
      message?: unknown
    }
  | {
      type: 'content_block_start'
      index?: number
      content_block?: {
        type: 'text' | 'tool_use'
        text?: string
        id?: string
        name?: string
      }
    }
  | {
      type: 'content_block_delta'
      index?: number
      delta?: {
        type: 'text_delta' | 'input_json_delta'
        text?: string
        partial_json?: string
      }
    }
  | {
      type: 'content_block_stop'
      index?: number
    }
  | {
      type: 'message_delta'
      delta?: {
        stop_reason?: string
      }
      usage?: {
        input_tokens?: number
        output_tokens?: number
      }
    }
  | {
      type: 'message_stop'
    }
  | {
      type: 'ping'
    }
