import type { ZodTypeAny } from 'zod'

/**
 * A chat message in the OpenAI/Anthropic-style conversation format.
 *
 * All four built-in providers (OpenAI, Anthropic, Google, Ollama)
 * translate this shape into their native wire format. The `tool` and
 * `tool_calls` variants support function calling.
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  /** Tool call ID if `role === 'tool'`. Set by the framework during tool loops. */
  toolCallId?: string
  /** Tool calls made by the assistant. Set by the provider. */
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>
}

/**
 * Input to `AiProvider.chat()` and `AiProvider.stream()`.
 *
 * Providers accept this shape, map it to their native format, call the
 * underlying API, and return a normalized `ChatResponse` (or stream of
 * `ChatChunk`s).
 */
export interface ChatInput {
  /** Conversation history, in order. System prompt can be the first message. */
  messages: ChatMessage[]
  /**
   * Optional model override. If omitted, the provider uses its default
   * model. Accepts provider-specific model IDs (e.g. `gpt-4o`, `claude-opus-4-6`).
   */
  model?: string
  /**
   * Tool registry reference. `'auto'` means "use every tool registered
   * via `@AiTool` in the current DI container". An array selects a
   * specific subset.
   */
  tools?: 'auto' | string[]
}

/** Runtime options for a chat call. */
export interface ChatOptions {
  temperature?: number
  maxTokens?: number
  topP?: number
  stopSequences?: string[]
  /** Abort signal — cancel the request mid-flight. */
  signal?: AbortSignal
}

/** Normalized response from a non-streaming chat call. */
export interface ChatResponse {
  /** The assistant's text output. */
  content: string
  /** Any tool calls the model made. Usually executed by the agent loop. */
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>
  /** Provider-reported token usage. */
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number }
  /** Finish reason from the provider. */
  finishReason?: 'stop' | 'length' | 'tool_call' | 'content_filter' | string
}

/** A single chunk from a streaming chat call. */
export interface ChatChunk {
  /** Incremental text delta. Empty for chunks that only carry tool deltas. */
  content: string
  /** Partial tool call delta, if the model is building one. */
  toolCallDelta?: { id: string; name?: string; argumentsDelta?: string }
  /** True on the final chunk. */
  done: boolean
}

/**
 * Input to `AiProvider.embed()`.
 *
 * Accepts a single string or an array; the response always matches the
 * input shape (single string → single vector, array → array of vectors).
 */
export type EmbedInput = string | string[]

/**
 * Input to `AiProvider.tool()` for one-shot tool execution outside the
 * normal chat flow. Useful for programmatic workflows where you know
 * which tool to call but want provider-specific argument normalization.
 */
export interface ToolCallInput {
  name: string
  arguments: Record<string, unknown>
}

/** Response from `AiProvider.tool()`. */
export interface ToolCallResponse {
  /** The raw tool result. Shape depends on the tool. */
  result: unknown
  /** Whether the provider considers the call successful. */
  ok: boolean
}

/**
 * Provider abstraction. All built-in providers (OpenAI, Anthropic,
 * Google, Ollama) implement this interface. Users can also implement
 * it for custom/internal providers.
 */
export interface AiProvider {
  /** Provider identifier — `'openai'`, `'anthropic'`, `'google'`, `'ollama'`, or a custom string. */
  name: string
  /** Non-streaming chat call. */
  chat(input: ChatInput, options?: ChatOptions): Promise<ChatResponse>
  /** Streaming chat call. Yields chunks until `done: true`. */
  stream(input: ChatInput, options?: ChatOptions): AsyncIterable<ChatChunk>
  /** Generate embeddings. Shape matches the input shape. */
  embed(input: EmbedInput): Promise<number[][]>
  /** One-shot tool execution. Optional — providers may omit. */
  tool?(input: ToolCallInput): Promise<ToolCallResponse>
}

/** Options for the `AiAdapter` constructor. */
export interface AiAdapterOptions {
  /** The active provider. Registered under the `AI_PROVIDER` DI token. */
  provider: AiProvider
  /**
   * Default chat options applied to every call unless overridden at
   * the call site. Useful for setting a project-wide temperature or
   * model.
   */
  defaults?: ChatOptions & { model?: string }
}

/**
 * Options for the `@AiTool` decorator.
 *
 * Marks a controller method as callable by the LLM. The input schema
 * is inferred from the route's `body` Zod schema — you don't repeat
 * it here.
 */
export interface AiToolOptions {
  /** Tool name override. Defaults to `<ControllerName>.<methodName>`. */
  name?: string
  /** Human-readable description shown to the LLM at tool-call time. */
  description: string
  /** Optional input schema override if the route has no Zod body. */
  inputSchema?: ZodTypeAny
}
