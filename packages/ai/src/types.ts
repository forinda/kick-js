import type { RouteFlagTest } from '@forinda/kickjs'

/**
 * A chat message in the OpenAI/Anthropic-style conversation format.
 *
 * The built-in providers (OpenAI, Anthropic) translate this shape into
 * their native wire format. The `tool` role and `toolCalls` support
 * function calling.
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  /** Tool call ID if `role === 'tool'`. Set by the framework during tool loops. */
  toolCallId?: string
  /** True on a `tool` message whose call failed. Providers that support it tell the model. */
  isError?: boolean
  /** Tool calls made by the assistant. Set by the provider. */
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>
  /**
   * Provider-native content of an assistant turn, copied from
   * `ChatResponse.providerContent`. The provider that produced it sends it
   * back verbatim — Anthropic needs its thinking blocks returned with the
   * tool calls they led to. Opaque and JSON-serializable; keep it when
   * storing history.
   */
  providerContent?: unknown
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
   * model. Accepts provider-specific model IDs (e.g. `gpt-4o`, `claude-opus-5`).
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
  /**
   * Sampling temperature. Models that reject sampling parameters (Claude
   * Opus 4.7+, Sonnet 5, Fable) ignore it, with a warning.
   */
  temperature?: number
  maxTokens?: number
  /** Nucleus sampling. Ignored, with a warning, by models that reject it. */
  topP?: number
  /**
   * How much effort the model spends (thinking depth and overall tokens),
   * where supported (Anthropic `output_config.effort`). Provider default
   * when omitted.
   */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
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
  usage?: ChatUsage
  /**
   * Why generation stopped, normalized: `'stop'`, `'length'` (token limit —
   * tool calls may be truncated), `'tool_call'`, `'content_filter'` (the
   * model declined; see `refusal`), or a provider-specific value.
   */
  finishReason?: 'stop' | 'length' | 'tool_call' | 'content_filter' | string
  /** Set when the model declined the request (`finishReason === 'content_filter'`). */
  refusal?: { category: string | null; explanation: string | null }
  /**
   * Provider-native content of this turn. Copy it onto the assistant
   * `ChatMessage` when continuing the conversation; see
   * `ChatMessage.providerContent`.
   */
  providerContent?: unknown
}

/** Token usage for one call. */
export interface ChatUsage {
  /** All input tokens, including cache reads and writes. */
  promptTokens: number
  completionTokens: number
  totalTokens: number
  /** Input tokens served from the prompt cache, where reported. */
  cacheReadTokens?: number
  /** Input tokens written to the prompt cache, where reported. */
  cacheWriteTokens?: number
}

/** A single chunk from a streaming chat call. */
export interface ChatChunk {
  /** Incremental text delta. Empty for chunks that only carry tool deltas. */
  content: string
  /**
   * Partial tool call delta, if the model is building one. `index`
   * identifies the call when several stream in parallel.
   */
  toolCallDelta?: { id: string; index?: number; name?: string; argumentsDelta?: string }
  /** True on the final chunk. */
  done: boolean
  /** On the final chunk: why generation stopped (see `ChatResponse.finishReason`). */
  finishReason?: ChatResponse['finishReason']
  /** On the final chunk, where the provider reports it. */
  usage?: ChatUsage
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
  /**
   * Expose routes carrying these [route flags](https://kickjs.app/guide/route-flags)
   * as tools, without `@AiTool` — on a method, a controller, or a module
   * mount (`routes: () => ({ …, flags: ['ai.tool'] })`). Takes the same
   * forms as `skipWhen`: a name, `'!name'`, a list, or a predicate.
   *
   * When the matching flag carries an object value, it is read as tool
   * options: `defineRouteFlag<Partial<AiToolOptions>>('ai.tool')`
   * then `@Tool({ description: 'Manage webhooks' })`. `@AiTool` on the
   * method takes precedence over the flag's options.
   */
  exposeWhen?: RouteFlagTest
  /**
   * Never expose routes carrying these route flags — wins over `@AiTool`
   * and `exposeWhen`. Use it to hide a whole controller or module mount,
   * including ones you don't own.
   */
  hideWhen?: RouteFlagTest
}

/**
 * Options for the `@AiTool` decorator.
 *
 * Marks a controller method as callable by the LLM. The input schema
 * is inferred from the route's `body` Zod schema — you don't repeat
 * it here.
 */
export interface AiToolOptions {
  /**
   * Tool name override. Defaults to `<ControllerName>_<methodName>`. Names
   * must match `[A-Za-z0-9_-]{1,64}` (the OpenAI and Anthropic rule); other
   * characters are replaced with `_`.
   */
  name?: string
  /** Human-readable description shown to the LLM at tool-call time. */
  description: string
  /**
   * Replace the tool's query/body input schema. Any schema library
   * `@forinda/kickjs-schema` supports (Zod, Valibot, Yup, Standard Schema).
   * Path parameters are still added. If omitted, the input is built from
   * the route's `params`, `query` and `body` schemas.
   */
  inputSchema?: unknown
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
  /**
   * Headers sent with every tool call, so the tool's route sees the caller's
   * credentials and context — typically copied from the request that started
   * the agent: `{ authorization: ctx.headers.authorization }`. `signal`
   * also aborts in-flight tool calls.
   */
  headers?: Headers | Record<string, string>
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
  /**
   * Why the final turn stopped (see `ChatResponse.finishReason`). On
   * `'content_filter'` or `'length'` any tool calls in that turn were not run.
   */
  finishReason?: ChatResponse['finishReason']
  /** Set when the model declined the request. */
  refusal?: ChatResponse['refusal']
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
   * Send tool calls to this base URL over HTTP instead of through the app
   * in-process. For tests that run the adapter's hooks by hand against their
   * own http.Server; `null` restores in-process dispatch.
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
