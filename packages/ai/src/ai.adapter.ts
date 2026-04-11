import {
  Logger,
  METADATA,
  Scope,
  getClassMeta,
  type AdapterContext,
  type AppAdapter,
  type Constructor,
  type RouteDefinition,
} from '@forinda/kickjs'
import { AI_PROVIDER } from './constants'
import { getAiToolMeta } from './decorators'
import type { RunAgentWithMemoryOptions } from './memory/types'
import { zodToJsonSchema } from './zod-to-json-schema'
import type {
  AiAdapterOptions,
  AiProvider,
  AiToolDefinition,
  ChatMessage,
  ChatToolDefinition,
  RunAgentOptions,
  RunAgentResult,
} from './types'

const log = Logger.for('AiAdapter')

/**
 * Register an AI provider in the DI container, discover every
 * `@AiTool`-decorated controller method, and run agent loops that
 * dispatch tool calls through the Express pipeline.
 *
 * The adapter plays the same role for AI as the MCP adapter plays for
 * external clients: it's the glue between the framework's metadata
 * (Zod schemas, route decorators, DI container) and a runtime that
 * can actually call LLMs and execute tools. Both adapters reuse the
 * framework's `onRouteMount` hook to discover tools at startup.
 *
 * @example
 * ```ts
 * import { bootstrap, getEnv } from '@forinda/kickjs'
 * import { AiAdapter, OpenAIProvider } from '@forinda/kickjs-ai'
 *
 * export const app = await bootstrap({
 *   modules,
 *   adapters: [
 *     new AiAdapter({
 *       provider: new OpenAIProvider({ apiKey: getEnv('OPENAI_API_KEY') }),
 *     }),
 *   ],
 * })
 * ```
 *
 * Then in any service:
 *
 * ```ts
 * @Service()
 * class AgentService {
 *   @Autowired() private readonly ai!: AiAdapter
 *
 *   async handleQuery(userPrompt: string) {
 *     const result = await this.ai.runAgent({
 *       messages: [
 *         { role: 'system', content: 'You can create tasks via tools.' },
 *         { role: 'user', content: userPrompt },
 *       ],
 *       tools: 'auto',  // use every @AiTool-decorated method
 *     })
 *     return result.content
 *   }
 * }
 * ```
 */
export class AiAdapter implements AppAdapter {
  readonly name = 'AiAdapter'

  private readonly provider: AiProvider

  /** Controllers collected during the mount phase, in insertion order. */
  private readonly mountedControllers: Array<{
    controller: Constructor
    mountPath: string
  }> = []

  /** Tool definitions built during `beforeStart` from `@AiTool` metadata. */
  private readonly tools: AiToolDefinition[] = []

  /**
   * Base URL of the running KickJS HTTP server, captured in `afterStart`.
   * Agent tool dispatch makes internal HTTP requests against this base
   * URL so calls flow through the normal Express pipeline (middleware,
   * validation, auth, logging, error handling).
   */
  private serverBaseUrl: string | null = null

  constructor(options: AiAdapterOptions) {
    this.provider = options.provider
  }

  /** Return the active provider. Useful for services that want the raw API. */
  getProvider(): AiProvider {
    return this.provider
  }

  /** Return the discovered tool registry. Primarily for tests and debug UIs. */
  getTools(): readonly AiToolDefinition[] {
    return this.tools
  }

  /**
   * Override the server base URL. Used by tests that spin up an
   * ephemeral http.Server and can't rely on the framework's
   * `afterStart` hook to supply it.
   */
  setServerBaseUrl(url: string | null): void {
    this.serverBaseUrl = url
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  /**
   * Record every mounted controller so `beforeStart` can walk them
   * looking for `@AiTool` decorations. We don't scan here because
   * onRouteMount fires per-controller and we want the scan to run
   * once against the full set.
   */
  onRouteMount(controller: Constructor, mountPath: string): void {
    this.mountedControllers.push({ controller, mountPath })
  }

  /**
   * Register the provider in the DI container and run the tool scan.
   *
   * The adapter itself is also registered under its class constructor
   * so services can inject the adapter directly (to call `runAgent`)
   * while other services inject just the provider via `AI_PROVIDER`
   * for plain `chat` / `embed` calls.
   */
  beforeStart({ container }: AdapterContext): void {
    container.registerFactory(AI_PROVIDER, () => this.provider, Scope.SINGLETON)
    container.registerInstance(AiAdapter, this)

    for (const { controller, mountPath } of this.mountedControllers) {
      const routes = getClassMeta<RouteDefinition[]>(METADATA.ROUTES, controller, [])
      for (const route of routes) {
        const tool = this.tryBuildTool(controller, mountPath, route)
        if (tool) this.tools.push(tool)
      }
    }

    log.info(
      `AiAdapter ready — provider: ${this.provider.name}, ${this.tools.length} tool(s) discovered`,
    )
  }

  /**
   * Capture the running server's address so agent dispatch can make
   * internal HTTP requests against the actual port. Runs after the
   * HTTP server is listening, so `server.address()` returns a real
   * `AddressInfo` here.
   */
  afterStart(ctx: AdapterContext): void {
    this.serverBaseUrl = this.resolveServerBaseUrl(ctx.server)
    log.debug(`AiAdapter agent dispatch target: ${this.serverBaseUrl ?? '(unknown)'}`)
  }

  /** Best-effort cleanup. Providers are currently stateless HTTP clients. */
  async shutdown(): Promise<void> {
    this.serverBaseUrl = null
    log.debug('AiAdapter shutdown complete')
  }

  // ── Agent loop ──────────────────────────────────────────────────────────

  /**
   * Run a tool-calling agent loop.
   *
   * Calls the provider with the given messages and tools, dispatches
   * any tool calls the model emits, feeds the results back into the
   * conversation, and repeats until the model responds with plain text
   * (no more tool calls) or `maxSteps` is reached.
   *
   * Tool dispatch goes through the Express pipeline via internal HTTP
   * requests — same pattern as the MCP adapter — so middleware, auth,
   * validation, logging, and error handling all apply to tool calls
   * the same way they apply to external client requests.
   *
   * @example
   * ```ts
   * const result = await adapter.runAgent({
   *   messages: [
   *     { role: 'system', content: 'Create tasks the user asks for.' },
   *     { role: 'user', content: 'Create a high-priority task titled Ship v3.' },
   *   ],
   *   tools: 'auto',
   *   maxSteps: 5,
   * })
   * console.log(result.content)   // assistant's final reply
   * console.log(result.messages)  // full history including tool calls
   * console.log(result.steps)     // how many rounds it took
   * ```
   */
  async runAgent(options: RunAgentOptions): Promise<RunAgentResult> {
    const maxSteps = options.maxSteps ?? 8
    const resolvedTools = this.resolveTools(options.tools ?? 'auto')

    const messages: ChatMessage[] = [...options.messages]
    let steps = 0
    const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

    for (let i = 0; i < maxSteps; i++) {
      steps++

      const response = await this.provider.chat(
        {
          messages,
          model: options.model,
          tools: resolvedTools.length > 0 ? resolvedTools : undefined,
        },
        {
          temperature: options.temperature,
          maxTokens: options.maxTokens,
          topP: options.topP,
          stopSequences: options.stopSequences,
          signal: options.signal,
        },
      )

      if (response.usage) {
        usage.promptTokens += response.usage.promptTokens
        usage.completionTokens += response.usage.completionTokens
        usage.totalTokens += response.usage.totalTokens
      }

      // If the model didn't request any tools, the loop is done.
      if (!response.toolCalls || response.toolCalls.length === 0) {
        messages.push({ role: 'assistant', content: response.content })
        return {
          content: response.content,
          messages,
          steps,
          usage: usage.totalTokens > 0 ? usage : undefined,
        }
      }

      // Record the assistant's tool-calling turn in the transcript.
      messages.push({
        role: 'assistant',
        content: response.content,
        toolCalls: response.toolCalls,
      })

      // Dispatch every tool call in parallel and feed the results back
      // to the model in the next iteration. Parallel dispatch is safe
      // because each tool call hits an independent HTTP route; any
      // side-effect ordering is the model's responsibility to request
      // sequentially.
      const results = await Promise.all(
        response.toolCalls.map((call) => this.dispatchToolCall(call)),
      )
      for (const result of results) {
        messages.push(result)
      }
    }

    // maxSteps exhausted — return whatever we have so the caller can react.
    const lastAssistant = messages
      .slice()
      .reverse()
      .find((m) => m.role === 'assistant')
    return {
      content: lastAssistant?.content ?? '',
      messages,
      steps,
      usage: usage.totalTokens > 0 ? usage : undefined,
      maxStepsReached: true,
    }
  }

  /**
   * Memory-aware agent turn.
   *
   * Wraps `runAgent` with an automatic "read history → append user
   * message → run loop → persist assistant response" cycle. Services
   * that want multi-turn conversations don't need to manage the
   * plumbing themselves — pass a `ChatMemory` and a user message,
   * get back the agent's response, and the memory is updated.
   *
   * System prompt handling:
   *   - If the memory is empty AND `systemPrompt` is provided, the
   *     system prompt is persisted as the first message in the
   *     session. It stays put for every subsequent turn.
   *   - On follow-up turns, the existing system prompt is reused
   *     from memory; the `systemPrompt` option is ignored to keep
   *     the session persona stable.
   *
   * Tool result persistence:
   *   - By default, tool messages are NOT persisted to memory —
   *     they're usually large API responses the user doesn't need
   *     on later turns, and including them blows up prompt tokens
   *     unnecessarily. Set `persistToolResults: true` to keep them
   *     (useful for debugging / full-transcript replay).
   *   - Assistant messages with tool calls ARE persisted so the
   *     conversation shows what the agent did.
   *
   * @example
   * ```ts
   * @Service()
   * class ChatService {
   *   @Autowired() private ai!: AiAdapter
   *   private readonly memory = new InMemoryChatMemory()
   *
   *   async handle(userMessage: string) {
   *     const result = await this.ai.runAgentWithMemory({
   *       memory: this.memory,
   *       userMessage,
   *       systemPrompt: 'You are a helpful assistant.',
   *       tools: 'auto',
   *     })
   *     return result.content
   *   }
   * }
   * ```
   */
  async runAgentWithMemory(options: RunAgentWithMemoryOptions): Promise<RunAgentResult> {
    const history = await options.memory.get()
    const messages: ChatMessage[] = [...history]

    // First-turn system prompt — only injected if the memory is
    // empty. Later turns rely on the persisted system prompt.
    const isFirstTurn = messages.length === 0
    if (isFirstTurn && options.systemPrompt) {
      const systemMessage: ChatMessage = { role: 'system', content: options.systemPrompt }
      messages.push(systemMessage)
      await options.memory.add(systemMessage)
    }

    const userMessage: ChatMessage = { role: 'user', content: options.userMessage }
    messages.push(userMessage)
    await options.memory.add(userMessage)

    const result = await this.runAgent({
      messages,
      model: options.model,
      tools: options.tools,
      maxSteps: options.maxSteps,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      topP: options.topP,
      stopSequences: options.stopSequences,
      signal: options.signal,
    })

    // Persist every message the loop produced AFTER the user turn.
    // Slice starts at messages.length because everything up to there
    // is already in memory.
    const newMessages = result.messages.slice(messages.length)
    const toPersist = options.persistToolResults
      ? newMessages
      : newMessages.filter((m) => m.role !== 'tool')
    if (toPersist.length > 0) {
      await options.memory.add(toPersist)
    }

    return result
  }

  // ── Tool resolution and dispatch ────────────────────────────────────────

  /**
   * Expand an agent `tools` option to an explicit array. `'auto'`
   * resolves to the full discovered registry; an explicit array is
   * passed through unchanged (so callers can restrict the agent to a
   * subset of tools).
   */
  private resolveTools(spec: 'auto' | ChatToolDefinition[]): ChatToolDefinition[] {
    if (spec === 'auto') return this.tools
    return spec
  }

  /**
   * Dispatch a single tool call through the Express pipeline by
   * making an internal HTTP request matching the underlying route's
   * method + path + body/query.
   *
   * Returns a `ChatMessage` with `role: 'tool'` suitable for feeding
   * back into the next `provider.chat` call. Non-2xx responses are
   * surfaced as tool error messages rather than throwing, so the
   * agent loop can let the model recover.
   */
  private async dispatchToolCall(call: {
    id: string
    name: string
    arguments: Record<string, unknown>
  }): Promise<ChatMessage> {
    const tool = this.tools.find((t) => t.name === call.name)
    if (!tool) {
      return {
        role: 'tool',
        toolCallId: call.id,
        content: JSON.stringify({ error: `Tool not found: ${call.name}` }),
      }
    }
    if (!this.serverBaseUrl) {
      return {
        role: 'tool',
        toolCallId: call.id,
        content: JSON.stringify({
          error: `Cannot dispatch ${call.name}: HTTP server address not yet captured`,
        }),
      }
    }

    const args = call.arguments ?? {}
    const { path, remainingArgs } = this.substitutePathParams(tool.mountPath, args)
    const method = tool.httpMethod.toUpperCase()
    const hasBody = method === 'POST' || method === 'PUT' || method === 'PATCH'

    let url = `${this.serverBaseUrl}${path}`
    const init: RequestInit = {
      method,
      headers: {
        accept: 'application/json',
        'x-ai-tool': tool.name,
      },
    }
    if (hasBody) {
      ;(init.headers as Record<string, string>)['content-type'] = 'application/json'
      init.body = JSON.stringify(remainingArgs)
    } else if (Object.keys(remainingArgs).length > 0) {
      const qs = new URLSearchParams()
      for (const [key, value] of Object.entries(remainingArgs)) {
        if (value === undefined || value === null) continue
        qs.append(key, typeof value === 'string' ? value : JSON.stringify(value))
      }
      const sep = url.includes('?') ? '&' : '?'
      url = `${url}${sep}${qs.toString()}`
    }

    try {
      const res = await fetch(url, init)
      const text = await res.text()
      const content = res.ok
        ? text || `(${res.status} ${res.statusText})`
        : JSON.stringify({
            error: `Tool ${call.name} returned ${res.status}`,
            body: text,
          })
      return { role: 'tool', toolCallId: call.id, content }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error(err as Error, `AiAdapter: tool dispatch failed for ${call.name}`)
      return {
        role: 'tool',
        toolCallId: call.id,
        content: JSON.stringify({ error: `Dispatch error: ${message}` }),
      }
    }
  }

  // ── Scan helpers (mirror McpAdapter for consistency) ───────────────────

  /**
   * Build an `AiToolDefinition` for a route decorated with `@AiTool`.
   * Skips routes without the decorator so the registry only exposes
   * deliberately opted-in methods.
   */
  private tryBuildTool(
    controller: Constructor,
    mountPath: string,
    route: RouteDefinition,
  ): AiToolDefinition | null {
    const meta = getAiToolMeta(controller.prototype, route.handlerName)
    if (!meta) return null

    const candidateSchema = meta.inputSchema ?? route.validation?.body ?? route.validation?.query
    const inputSchema = zodToJsonSchema(candidateSchema) ?? {
      type: 'object',
      properties: {},
      additionalProperties: false,
    }

    return {
      name: meta.name ?? `${controller.name}.${route.handlerName}`,
      description: meta.description,
      inputSchema,
      httpMethod: route.method.toUpperCase(),
      mountPath: this.joinMountPath(mountPath, route.path),
    }
  }

  /**
   * Join a module mount path with the route-level sub-path. Same
   * helper as McpAdapter's — kept local so the two packages don't
   * couple via a shared util file.
   */
  private joinMountPath(mountPath: string, routePath: string): string {
    const base = mountPath.endsWith('/') ? mountPath.slice(0, -1) : mountPath
    if (!routePath || routePath === '/') return base
    const sub = routePath.startsWith('/') ? routePath : `/${routePath}`
    return `${base}${sub}`
  }

  /**
   * Substitute Express-style `:param` placeholders in the mount path
   * with values pulled from the tool call arguments. Consumed keys
   * are removed from the remaining args so they aren't sent twice
   * (once in the path, once in the body/query).
   */
  private substitutePathParams(
    mountPath: string,
    args: Record<string, unknown>,
  ): { path: string; remainingArgs: Record<string, unknown> } {
    const remaining: Record<string, unknown> = { ...args }
    const path = mountPath.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_match, param: string) => {
      if (param in remaining) {
        const value = remaining[param]
        delete remaining[param]
        return encodeURIComponent(String(value))
      }
      return `:${param}`
    })
    return { path, remainingArgs: remaining }
  }

  /**
   * Resolve the running server's base URL from a Node `http.Server`
   * instance. Same handling as McpAdapter: IPv6 bracketing, rewrite
   * of 0.0.0.0/:: to 127.0.0.1.
   */
  private resolveServerBaseUrl(server: AdapterContext['server']): string | null {
    if (!server) return null
    const address = server.address()
    if (!address || typeof address === 'string') return null
    let host = address.address
    if (host === '::' || host === '0.0.0.0' || host === '') host = '127.0.0.1'
    if (host.includes(':') && !host.startsWith('[')) host = `[${host}]`
    return `http://${host}:${address.port}`
  }
}
