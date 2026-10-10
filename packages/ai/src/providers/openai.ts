import type {
  ContentPart,
  AiProvider,
  ChatChunk,
  ChatInput,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  EmbedInput,
  EmbedOptions,
} from '../types'
import { postJson, postJsonStream, ProviderError, type RetryOptions } from './base'
import { assertAttachmentsAllowed, resolvePart } from '../attachments'
import {
  SCHEMA_STREAM_ERROR,
  chatWithSchema,
  isStrictCompatible,
  outputSchema,
  type OutputSchema,
} from '../structured'

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
  /** Retries for transient failures (429, 5xx). Defaults to 3 with backoff; `{ maxRetries: 0 }` disables. */
  retry?: RetryOptions
  /**
   * Sends every request instead of the global `fetch` — a proxy or custom
   * TLS (an undici `Agent`), tracing, extra headers, or a runtime without a
   * global `fetch`. Called the way `fetch` is; retries and streaming use it too.
   */
  fetch?: typeof fetch
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
 * import { bootstrap, getEnv } from '@forinda/kickjs'
 * import { AiAdapter, OpenAIProvider } from '@forinda/kickjs-ai'
 *
 * export const app = await bootstrap({
 *   modules,
 *   adapters: [
 *     AiAdapter({
 *       provider: new OpenAIProvider({
 *         apiKey: getEnv('OPENAI_API_KEY'),
 *         defaultChatModel: 'gpt-4o-mini',
 *       }),
 *     }),
 *   ],
 * })
 * ```
 */
export class OpenAIProvider implements AiProvider {
  readonly name: string

  private readonly baseURL: string
  private readonly defaultChatModel: string
  private readonly defaultEmbedModel: string
  /**
   * Full header map passed to every request. Includes the bearer auth
   * header and the optional openai-organization header. Constructed
   * once in the constructor so per-call code just spreads it into the
   * fetch init.
   */
  private readonly headers: Record<string, string>
  private readonly retry?: RetryOptions
  private readonly fetch?: typeof fetch

  constructor(options: OpenAIProviderOptions) {
    if (!options.apiKey) {
      throw new Error('OpenAIProvider: apiKey is required')
    }
    this.baseURL = (options.baseURL ?? 'https://api.openai.com/v1').replace(/\/$/, '')
    this.defaultChatModel = options.defaultChatModel ?? 'gpt-4o-mini'
    this.defaultEmbedModel = options.defaultEmbedModel ?? 'text-embedding-3-small'
    this.name = options.name ?? 'openai'
    this.retry = options.retry
    this.fetch = options.fetch
    this.headers = {
      authorization: `Bearer ${options.apiKey}`,
      ...(options.organization ? { 'openai-organization': options.organization } : {}),
    }
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
    if (input.schema === undefined) return this.chatOnce(input, options)
    const schema = outputSchema(input.schema, input.schemaName)
    return chatWithSchema(input, schema, async (attempt) => {
      const response = await this.chatOnce(attempt, options, schema)
      return { response, answer: response.content }
    })
  }

  private async chatOnce(
    input: ChatInput,
    options: ChatOptions,
    schema?: OutputSchema,
  ): Promise<ChatResponse> {
    const payload = this.buildChatPayload(input, options, /* stream */ false, schema)
    const data = await postJson<OpenAIChatResponse>(`${this.baseURL}/chat/completions`, payload, {
      headers: this.headers,
      signal: options.signal,
      retry: this.retry,
      fetch: this.fetch,
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
    if (input.schema !== undefined) throw new Error(SCHEMA_STREAM_ERROR)
    const payload = this.buildChatPayload(input, options, /* stream */ true)
    const events = postJsonStream(`${this.baseURL}/chat/completions`, payload, {
      headers: this.headers,
      signal: options.signal,
      retry: this.retry,
      fetch: this.fetch,
    })

    let sawAnyChunk = false
    let finishReason: ChatChunk['finishReason']
    let usage: ChatChunk['usage']
    // OpenAI sends a tool call's id only on its first delta; later deltas
    // carry just the index.
    const toolIds = new Map<number, string>()
    const finalChunk = (): ChatChunk => ({
      content: '',
      done: true,
      ...(finishReason ? { finishReason } : {}),
      ...(usage ? { usage } : {}),
    })

    for await (const raw of events) {
      // OpenAI signals end-of-stream with a literal `[DONE]` payload
      // (not JSON). Translate to a final framework chunk.
      if (raw === '[DONE]') {
        yield finalChunk()
        return
      }

      let parsed: OpenAIStreamChunk
      try {
        parsed = JSON.parse(raw) as OpenAIStreamChunk
      } catch {
        // Malformed chunk — ignore rather than crash the stream.
        continue
      }

      // With include_usage, the last chunk carries usage and no choices.
      if (parsed.usage) usage = normalizeUsage(parsed.usage)
      const choice = parsed.choices?.[0]
      if (!choice) continue
      if (choice.finish_reason) finishReason = normalizeFinishReason(choice.finish_reason)

      sawAnyChunk = true
      if (choice.delta?.content) yield { content: choice.delta.content, done: false }
      for (const call of choice.delta?.tool_calls ?? []) {
        const index = call.index ?? 0
        if (call.id) toolIds.set(index, call.id)
        const toolCallDelta: NonNullable<ChatChunk['toolCallDelta']> = {
          id: toolIds.get(index) ?? '',
          index,
        }
        if (call.function?.name) toolCallDelta.name = call.function.name
        if (call.function?.arguments !== undefined) {
          toolCallDelta.argumentsDelta = call.function.arguments
        }
        yield { content: '', done: false, toolCallDelta }
      }
    }

    // If the stream closed without a [DONE] sentinel, still emit a
    // terminating chunk so consumers know to stop reading.
    if (sawAnyChunk) {
      yield finalChunk()
    }
  }

  /**
   * Generate embeddings for a string or array of strings.
   *
   * Returns vectors in input order. Single-string input still gets a
   * length-1 array back, so callers can use the same indexed access
   * pattern regardless of input shape.
   */
  async embed(input: EmbedInput, options: EmbedOptions = {}): Promise<number[][]> {
    const inputs = Array.isArray(input) ? input : [input]
    if (inputs.length === 0) return []

    const data = await postJson<OpenAIEmbeddingResponse>(
      `${this.baseURL}/embeddings`,
      {
        model: this.defaultEmbedModel,
        input: inputs,
      },
      { headers: this.headers, signal: options.signal, retry: this.retry, fetch: this.fetch },
    )

    if (!data.data || !Array.isArray(data.data)) {
      throw new ProviderError(200, JSON.stringify(data), 'OpenAI embedding response had no data')
    }

    // Sort by index so we always return vectors in the order we sent
    // them, even if the API decides to interleave responses.
    return [...data.data].toSorted((a, b) => a.index - b.index).map((d) => d.embedding)
  }

  // ── Internal: payload construction ──────────────────────────────────

  private buildChatPayload(
    input: ChatInput,
    options: ChatOptions,
    stream: boolean,
    schema?: OutputSchema,
  ): OpenAIChatRequest {
    const payload: OpenAIChatRequest = {
      model: input.model ?? this.defaultChatModel,
      messages: input.messages.map((m) => this.toOpenAIMessage(m)),
      stream,
    }
    if (stream) payload.stream_options = { include_usage: true }
    if (options.temperature !== undefined) payload.temperature = options.temperature
    // max_tokens is deprecated and rejected by reasoning models.
    if (options.maxTokens !== undefined) payload.max_completion_tokens = options.maxTokens
    if (options.topP !== undefined) payload.top_p = options.topP
    if (options.stopSequences && options.stopSequences.length > 0) {
      payload.stop = options.stopSequences
    }

    // Tools: only include when the caller passes an explicit array.
    // `'auto'` at the provider level is a no-op — it's only meaningful
    // inside `AiAdapter.runAgent`, which expands it against the
    // `@AiTool` registry before calling the provider.
    if (Array.isArray(input.tools) && input.tools.length > 0) {
      payload.tools = input.tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      }))
    }

    if (schema) {
      payload.response_format = {
        type: 'json_schema',
        json_schema: {
          name: schema.name,
          schema: schema.jsonSchema,
          // Strict guarantees the shape, but only accepts closed objects
          // with every property required; other schemas go without it.
          strict: isStrictCompatible(schema.jsonSchema),
        },
      }
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
    assertAttachmentsAllowed(m.role, m.attachments)
    if (m.role === 'user' && m.attachments?.length) {
      return {
        role: 'user',
        content: [
          // Files first: the model reads them before the question about them.
          ...m.attachments.map(toOpenAIPart),
          ...(m.content ? [{ type: 'text' as const, text: m.content }] : []),
        ],
      }
    }
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
    if (data.usage) result.usage = normalizeUsage(data.usage)
    if (choice?.finish_reason) result.finishReason = normalizeFinishReason(choice.finish_reason)
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
  stream_options?: { include_usage: boolean }
  temperature?: number
  max_completion_tokens?: number
  top_p?: number
  stop?: string[]
  response_format?: {
    type: 'json_schema'
    json_schema: { name: string; schema: Record<string, unknown>; strict: boolean }
  }
  tools?: Array<{
    type: 'function'
    function: {
      name: string
      description: string
      parameters: Record<string, unknown>
    }
  }>
}

type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'file'; file: { filename: string; file_data: string } }

/**
 * A content part as a Chat Completions part: an image as a URL or data URL, a
 * PDF as an inline file, text as text (headed by its file name). Chat
 * Completions can't fetch a PDF by URL, so that throws instead of being dropped.
 */
function toOpenAIPart(part: ContentPart): OpenAIContentPart {
  const r = resolvePart(part)
  if (r.kind === 'image') {
    return {
      type: 'image_url',
      image_url: { url: r.url ?? `data:${r.mediaType};base64,${r.base64}` },
    }
  }
  if (r.kind === 'pdf') {
    if (r.url) {
      throw new Error(
        'OpenAIProvider: Chat Completions does not fetch PDFs by URL — download it and send the contents.',
      )
    }
    return {
      type: 'file',
      file: {
        filename: r.filename ?? 'document.pdf',
        file_data: `data:application/pdf;base64,${r.base64}`,
      },
    }
  }
  return { type: 'text', text: r.filename ? `${r.filename}:\n${r.text}` : r.text }
}

type OpenAIMessage =
  | { role: 'system' | 'user' | 'assistant'; content: string }
  | { role: 'user'; content: OpenAIContentPart[] }
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
  usage?: OpenAIUsage | null
}

interface OpenAIUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  prompt_tokens_details?: { cached_tokens?: number }
}

function normalizeUsage(usage: OpenAIUsage): NonNullable<ChatResponse['usage']> {
  const result: NonNullable<ChatResponse['usage']> = {
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
  }
  const cached = usage.prompt_tokens_details?.cached_tokens
  if (cached) result.cacheReadTokens = cached
  return result
}

/** OpenAI finish reasons → the framework's (`tool_calls` → `tool_call`). */
function normalizeFinishReason(reason: string): NonNullable<ChatResponse['finishReason']> {
  return reason === 'tool_calls' || reason === 'function_call' ? 'tool_call' : reason
}

interface OpenAIEmbeddingResponse {
  data: Array<{ index: number; embedding: number[] }>
}
