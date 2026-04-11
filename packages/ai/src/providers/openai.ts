import type {
  AiProvider,
  ChatChunk,
  ChatInput,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  EmbedInput,
} from '../types'
import { postJson, postJsonStream, ProviderError } from './base'

/**
 * Configuration for the built-in OpenAI provider.
 *
 * The base URL is configurable so the same provider class can target
 * any OpenAI-compatible endpoint — Azure OpenAI, Ollama's
 * `/v1/chat/completions` shim, OpenRouter, vLLM, and so on. The
 * provider only assumes the wire shape, not the hostname.
 */
export interface OpenAIProviderOptions {
  /** API key sent as `Authorization: Bearer <apiKey>`. Required. */
  apiKey: string
  /** Override base URL. Defaults to `https://api.openai.com/v1`. */
  baseURL?: string
  /** Default chat model used when `ChatInput.model` is not set. */
  defaultChatModel?: string
  /** Default embedding model used by `embed()`. */
  defaultEmbedModel?: string
  /**
   * OpenAI organization header. Optional. Some accounts need it; most
   * don't. If unset, the header is omitted entirely.
   */
  organization?: string
  /**
   * Provider name to expose on `provider.name`. Defaults to `'openai'`
   * but can be overridden to label compatible endpoints — e.g.
   * `'ollama'` if pointing baseURL at a local Ollama instance.
   */
  name?: string
}

/**
 * Built-in OpenAI provider.
 *
 * Implements the framework's `AiProvider` interface using nothing but
 * the global `fetch` API (Node 20+). Translates the framework's
 * normalized chat shape to OpenAI's `/chat/completions` wire format
 * and back, including streaming via SSE.
 *
 * Tool calling is wired in this provider but the agent loop that
 * actually invokes tools and feeds results back to the model lives in
 * a later phase — for now, `chat()` and `stream()` surface tool calls
 * via `ChatResponse.toolCalls` so callers can react.
 *
 * @example
 * ```ts
 * import { AiAdapter } from '@forinda/kickjs-ai'
 * import { OpenAIProvider } from '@forinda/kickjs-ai/providers/openai'
 *
 * export const app = await bootstrap({
 *   modules,
 *   adapters: [
 *     new AiAdapter({
 *       provider: new OpenAIProvider({
 *         apiKey: process.env.OPENAI_API_KEY!,
 *         defaultChatModel: 'gpt-4o-mini',
 *       }),
 *     }),
 *   ],
 * })
 * ```
 */
export class OpenAIProvider implements AiProvider {
  readonly name: string

  private readonly apiKey: string
  private readonly baseURL: string
  private readonly defaultChatModel: string
  private readonly defaultEmbedModel: string
  private readonly extraHeaders: Record<string, string>

  constructor(options: OpenAIProviderOptions) {
    if (!options.apiKey) {
      throw new Error('OpenAIProvider: apiKey is required')
    }
    this.apiKey = options.apiKey
    this.baseURL = (options.baseURL ?? 'https://api.openai.com/v1').replace(/\/$/, '')
    this.defaultChatModel = options.defaultChatModel ?? 'gpt-4o-mini'
    this.defaultEmbedModel = options.defaultEmbedModel ?? 'text-embedding-3-small'
    this.name = options.name ?? 'openai'
    this.extraHeaders = options.organization ? { 'openai-organization': options.organization } : {}
  }

  /**
   * Non-streaming chat completion.
   *
   * Translates the framework's `ChatInput` to OpenAI's chat completion
   * payload, posts it, and normalizes the response back to a
   * `ChatResponse`. Tool calls are surfaced on the response so callers
   * can decide whether to feed them back into a tool registry.
   */
  async chat(input: ChatInput, options: ChatOptions = {}): Promise<ChatResponse> {
    const payload = this.buildChatPayload(input, options, /* stream */ false)
    const data = await postJson<OpenAIChatResponse>(`${this.baseURL}/chat/completions`, payload, {
      apiKey: this.apiKey,
      headers: this.extraHeaders,
      signal: options.signal,
    })
    return this.normalizeChatResponse(data)
  }

  /**
   * Streaming chat completion. Yields `ChatChunk`s as deltas arrive
   * over the wire and emits one final chunk with `done: true` after
   * the upstream `[DONE]` sentinel.
   *
   * Cancellation via `options.signal` is supported end-to-end — the
   * underlying fetch is aborted and the consumer's `for await` loop
   * throws `AbortError`.
   */
  async *stream(input: ChatInput, options: ChatOptions = {}): AsyncIterable<ChatChunk> {
    const payload = this.buildChatPayload(input, options, /* stream */ true)
    const events = postJsonStream(`${this.baseURL}/chat/completions`, payload, {
      apiKey: this.apiKey,
      headers: this.extraHeaders,
      signal: options.signal,
    })

    let sawAnyChunk = false

    for await (const raw of events) {
      // OpenAI signals end-of-stream with a literal `[DONE]` payload
      // (not JSON). Translate to a final framework chunk.
      if (raw === '[DONE]') {
        yield { content: '', done: true }
        return
      }

      let parsed: OpenAIStreamChunk
      try {
        parsed = JSON.parse(raw) as OpenAIStreamChunk
      } catch {
        // Malformed chunk — ignore rather than crash the stream.
        continue
      }

      const choice = parsed.choices?.[0]
      if (!choice) continue

      const deltaContent = choice.delta?.content ?? ''
      const toolCallDelta = this.firstToolCallDelta(choice.delta?.tool_calls)

      sawAnyChunk = true
      const chunk: ChatChunk = {
        content: deltaContent,
        done: false,
      }
      if (toolCallDelta) chunk.toolCallDelta = toolCallDelta
      yield chunk
    }

    // If the stream closed without a [DONE] sentinel, still emit a
    // terminating chunk so consumers know to stop reading.
    if (sawAnyChunk) {
      yield { content: '', done: true }
    }
  }

  /**
   * Generate embeddings for a string or array of strings.
   *
   * Returns vectors in input order. Single-string input still gets a
   * length-1 array back, so callers can use the same indexed access
   * pattern regardless of input shape.
   */
  async embed(input: EmbedInput): Promise<number[][]> {
    const inputs = Array.isArray(input) ? input : [input]
    if (inputs.length === 0) return []

    const data = await postJson<OpenAIEmbeddingResponse>(
      `${this.baseURL}/embeddings`,
      {
        model: this.defaultEmbedModel,
        input: inputs,
      },
      {
        apiKey: this.apiKey,
        headers: this.extraHeaders,
      },
    )

    if (!data.data || !Array.isArray(data.data)) {
      throw new ProviderError(200, JSON.stringify(data), 'OpenAI embedding response had no data')
    }

    // Sort by index so we always return vectors in the order we sent
    // them, even if the API decides to interleave responses.
    return [...data.data].sort((a, b) => a.index - b.index).map((d) => d.embedding)
  }

  // ── Internal: payload construction ──────────────────────────────────

  private buildChatPayload(
    input: ChatInput,
    options: ChatOptions,
    stream: boolean,
  ): OpenAIChatRequest {
    const payload: OpenAIChatRequest = {
      model: input.model ?? this.defaultChatModel,
      messages: input.messages.map((m) => this.toOpenAIMessage(m)),
      stream,
    }
    if (options.temperature !== undefined) payload.temperature = options.temperature
    if (options.maxTokens !== undefined) payload.max_tokens = options.maxTokens
    if (options.topP !== undefined) payload.top_p = options.topP
    if (options.stopSequences && options.stopSequences.length > 0) {
      payload.stop = options.stopSequences
    }
    return payload
  }

  /**
   * Translate a framework `ChatMessage` to OpenAI's wire format.
   * Handles the `tool` role and the `tool_calls` field on assistant
   * messages, both of which use slightly different shapes than the
   * normalized form on `ChatMessage`.
   */
  private toOpenAIMessage(m: ChatMessage): OpenAIMessage {
    if (m.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: m.toolCallId ?? '',
        content: m.content,
      }
    }
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      return {
        role: 'assistant',
        content: m.content,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      }
    }
    return { role: m.role as 'system' | 'user' | 'assistant', content: m.content }
  }

  /**
   * Normalize an OpenAI chat completion response back to the
   * framework's `ChatResponse` shape.
   */
  private normalizeChatResponse(data: OpenAIChatResponse): ChatResponse {
    const choice = data.choices?.[0]
    const message = choice?.message
    const content = typeof message?.content === 'string' ? message.content : ''

    const toolCalls = message?.tool_calls
      ?.filter((tc): tc is OpenAIToolCall & { function: NonNullable<OpenAIToolCall['function']> } =>
        Boolean(tc.function?.name),
      )
      .map((tc) => {
        let args: Record<string, unknown> = {}
        try {
          args = tc.function!.arguments ? JSON.parse(tc.function!.arguments) : {}
        } catch {
          // OpenAI is supposed to send valid JSON in arguments, but if
          // it doesn't, surface the raw string under a generic key
          // rather than dropping the call entirely.
          args = { _raw: tc.function!.arguments }
        }
        return { id: tc.id, name: tc.function!.name, arguments: args }
      })

    const result: ChatResponse = { content }
    if (toolCalls && toolCalls.length > 0) result.toolCalls = toolCalls
    if (data.usage) {
      result.usage = {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      }
    }
    if (choice?.finish_reason) result.finishReason = choice.finish_reason
    return result
  }

  /**
   * Extract the first tool-call delta from an OpenAI streaming chunk.
   *
   * The `tool_calls` array in a delta chunk can contain partial state
   * for multiple parallel tool calls; this method picks the first one
   * with a non-empty payload, which is enough for the v0 streaming
   * surface. Multi-tool streaming is a follow-up.
   */
  private firstToolCallDelta(
    toolCalls?: OpenAIStreamChunk['choices'][number]['delta']['tool_calls'],
  ): ChatChunk['toolCallDelta'] {
    if (!toolCalls || toolCalls.length === 0) return undefined
    const first = toolCalls[0]
    if (!first) return undefined
    const result: NonNullable<ChatChunk['toolCallDelta']> = {
      id: first.id ?? '',
    }
    if (first.function?.name) result.name = first.function.name
    if (first.function?.arguments !== undefined) result.argumentsDelta = first.function.arguments
    return result
  }
}

// ── OpenAI wire types ─────────────────────────────────────────────────────
//
// These mirror the parts of the OpenAI Chat Completions and Embeddings
// API responses we actually consume. They're intentionally narrower
// than the full API surface so the provider stays focused on what the
// framework needs, and so we don't accidentally couple to fields that
// might change in future API versions.

interface OpenAIChatRequest {
  model: string
  messages: OpenAIMessage[]
  stream?: boolean
  temperature?: number
  max_tokens?: number
  top_p?: number
  stop?: string[]
}

type OpenAIMessage =
  | { role: 'system' | 'user' | 'assistant'; content: string }
  | {
      role: 'assistant'
      content: string
      tool_calls: Array<{
        id: string
        type: 'function'
        function: { name: string; arguments: string }
      }>
    }
  | { role: 'tool'; content: string; tool_call_id: string }

interface OpenAIToolCall {
  id: string
  type?: 'function'
  function?: { name: string; arguments: string }
}

interface OpenAIChatResponse {
  choices?: Array<{
    message?: { content?: string; tool_calls?: OpenAIToolCall[] }
    finish_reason?: string
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

interface OpenAIStreamChunk {
  choices: Array<{
    delta: {
      content?: string
      tool_calls?: Array<{
        index?: number
        id?: string
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason?: string | null
  }>
}

interface OpenAIEmbeddingResponse {
  data: Array<{ index: number; embedding: number[] }>
}
