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
 * A resolved tool definition that providers can include in their
 * wire-format request payload. This is the shape `ChatInput.tools`
 * carries once `AiAdapter.runAgent` has expanded `'auto'` against
 * the registry of `@AiTool`-decorated controller methods.
 *
 * Providers translate this into their native tool-calling format
 * (OpenAI's `tools`, Anthropic's `tools`, Google's function declarations,
 * etc.). The shape is deliberately minimal — anything provider-specific
 * lives in the provider implementation, not on this type.
 */
export interface ChatToolDefinition {
  /** Stable tool identifier, e.g. "TaskController.create". */
  name: string
  /** Human-readable description shown to the model at call time. */
  description: string
  /**
   * JSON Schema for the tool input, converted from the Zod body schema
   * on the underlying route. Providers pass this through to the wire
   * payload verbatim; the schema only needs to be valid JSON Schema.
   */
  inputSchema: Record<string, unknown>
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
   * Tools the model can call.
   *
   * - `'auto'` — only meaningful when passed to `AiAdapter.runAgent`,
   *   which resolves it against the `@AiTool` registry before handing
   *   the request to the provider. Raw providers that receive `'auto'`
   *   directly omit tools entirely rather than doing a hidden lookup.
   * - An array of `ChatToolDefinition` — providers include these in
   *   the wire payload directly.
   * - Omitted — no tool-calling in this request.
   */
  tools?: 'auto' | ChatToolDefinition[]
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

/**
 * Resolved AI tool definition built by the adapter's startup scan.
 *
 * Bundles the tool's wire-format definition (`ChatToolDefinition`)
 * with the HTTP routing info needed for dispatch (`httpMethod` +
 * `mountPath`). `AiAdapter.runAgent` hands `ChatToolDefinition[]` to
 * the provider and keeps `httpMethod`/`mountPath` internal for the
 * dispatch loop.
 */
export interface AiToolDefinition extends ChatToolDefinition {
  /** HTTP method of the underlying route. */
  httpMethod: string
  /** Full mount path of the underlying route (after apiPrefix + version). */
  mountPath: string
}

/**
 * Options for `AiAdapter.runAgent()`.
 *
 * Runs a tool-calling loop: the provider responds, any tool calls are
 * dispatched through the Express pipeline, results are fed back, and
 * the loop continues until the model returns plain text or the
 * `maxSteps` cap is hit.
 */
export interface RunAgentOptions extends ChatOptions {
  /** Starting conversation. System prompt can be the first message. */
  messages: ChatMessage[]
  /** Model override. Defaults to the provider's configured default. */
  model?: string
  /**
   * Tools the agent can call. Defaults to `'auto'` — every tool in
   * the adapter's `@AiTool` registry. Pass an explicit array to
   * restrict the agent to a subset.
   */
  tools?: 'auto' | ChatToolDefinition[]
  /**
   * Maximum number of chat → tool-call → dispatch → feedback cycles
   * before the loop gives up. Prevents runaway loops on broken tool
   * call behavior. Defaults to 8.
   */
  maxSteps?: number
}

/** Result of `AiAdapter.runAgent()` — the final assistant response. */
export interface RunAgentResult {
  /** The assistant's final text output after all tool calls resolved. */
  content: string
  /** The full message history including tool calls and results. */
  messages: ChatMessage[]
  /** Number of chat iterations the loop ran before terminating. */
  steps: number
  /** Aggregated usage across every provider call in the loop. */
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number }
  /** True if the loop stopped because `maxSteps` was reached. */
  maxStepsReached?: boolean
}

/**
 * Public extension surface exposed by an AiAdapter instance — agent
 * loops, tool inspection, and the active provider. Surfaced via
 * `defineAdapter`'s `TExtra` generic so consumers that
 * `@Inject(AI_ADAPTER)` get the full API on the resolved instance.
 */
export interface AiAdapterExtensions {
  /** Return the active provider. Useful for services that want the raw API. */
  getProvider(): AiProvider
  /** Return the discovered tool registry. Primarily for tests and debug UIs. */
  getTools(): readonly AiToolDefinition[]
  /**
   * Override the server base URL. Used by tests that spin up an
   * ephemeral http.Server and can't rely on the framework's `afterStart`
   * hook to supply it.
   */
  setServerBaseUrl(url: string | null): void
  /** Run a tool-calling agent loop. */
  runAgent(options: RunAgentOptions): Promise<RunAgentResult>
  /** Memory-aware agent turn — wraps `runAgent` with persisted history. */
  runAgentWithMemory(
    options: import('./memory/types').RunAgentWithMemoryOptions,
  ): Promise<RunAgentResult>
}

/**
 * Resolved AiAdapter type — the value returned by `AiAdapter(options)`.
 * Carries both the standard {@link AppAdapter} contract and the
 * {@link AiAdapterExtensions} agent-loop / tool-inspection surface.
 */
export type AiAdapterInstance = import('@forinda/kickjs').AppAdapter & AiAdapterExtensions
