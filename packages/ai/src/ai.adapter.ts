import {
  Logger,
  METADATA,
  Scope,
  defineAdapter,
  getClassMeta,
  getRouteFlags,
  matchesFlagTest,
  type AdapterContext,
  type Constructor,
  type RouteDefinition,
  type RouteFlagTest,
  type RouteFlags,
} from '@forinda/kickjs'
import { AI_ADAPTER, AI_PROVIDER } from './constants'
import { getAiToolMeta } from './decorators'
import type { RunAgentWithMemoryOptions } from './memory/types'
import { buildRouteTool, type RouteTool } from '@forinda/kickjs-schema'
import type {
  AiAdapterExtensions,
  AiAdapterOptions,
  AiToolDefinition,
  AiToolOptions,
  ChatMessage,
  ChatToolDefinition,
  RunAgentOptions,
  RunAgentResult,
} from './types'

const log = Logger.for('AiAdapter')

/**
 * Tool options carried by a flag named in `exposeWhen`: the value of the
 * first such flag the route carries that is an object, e.g.
 * `@Tool({ description: '…' })` for `defineRouteFlag<AiToolOptions>('…')`.
 * Predicates and negated names name no flag, so they carry no options.
 */
function flagToolOptions(test: RouteFlagTest, flags: RouteFlags): Partial<AiToolOptions> {
  const names = (typeof test === 'string' ? [test] : Array.isArray(test) ? test : []).filter(
    (name: string) => !name.startsWith('!'),
  )
  for (const name of names) {
    const value = flags.get(name)
    if (value && typeof value === 'object') return value as Partial<AiToolOptions>
  }
  return {}
}

/** Tool names OpenAI and Anthropic accept. */
const PROVIDER_TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/

/** A tool name providers accept, replacing any other character with `_`. */
function toolNameFor(name: string, handler: string): string {
  if (PROVIDER_TOOL_NAME.test(name)) return name
  const cleaned = name.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || '_'
  log.warn(
    `AiAdapter: tool name "${name}" (${handler}) is not accepted by providers; using "${cleaned}"`,
  )
  return cleaned
}

/**
 * Register an AI provider in the DI container, discover every
 * `@AiTool`-decorated controller method, and run agent loops that
 * dispatch tool calls through the Express pipeline.
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
 *       provider: new OpenAIProvider({ apiKey: getEnv('OPENAI_API_KEY') }),
 *     }),
 *   ],
 * })
 * ```
 *
 * Then in any service:
 *
 * ```ts
 * import { AI_ADAPTER, type AiAdapterInstance } from '@forinda/kickjs-ai'
 *
 * @Service()
 * class AgentService {
 *   constructor(@Inject(AI_ADAPTER) private readonly ai: AiAdapterInstance) {}
 *
 *   async handleQuery(userPrompt: string) {
 *     const result = await this.ai.runAgent({
 *       messages: [
 *         { role: 'system', content: 'You can create tasks via tools.' },
 *         { role: 'user', content: userPrompt },
 *       ],
 *       tools: 'auto',
 *     })
 *     return result.content
 *   }
 * }
 * ```
 */
export const AiAdapter = defineAdapter<AiAdapterOptions, AiAdapterExtensions>({
  name: 'AiAdapter',
  build: (options) => {
    // A mixed-polarity list fails here, where the adapter is configured,
    // not later inside startup where the error would be swallowed.
    if (options.exposeWhen) matchesFlagTest(options.exposeWhen, undefined)
    if (options.hideWhen) matchesFlagTest(options.hideWhen, undefined)

    const provider = options.provider

    /** Controllers collected during the mount phase, in insertion order. */
    const mountedControllers: Array<{ controller: Constructor; mountPath: string }> = []

    /** Tool definitions built during `beforeStart` from `@AiTool` metadata. */
    const tools: AiToolDefinition[] = []

    /** Argument-to-request mapping per tool name. */
    const routeTools = new Map<string, RouteTool>()

    /**
     * Runs a Request through this app's pipeline, from `AdapterContext.fetch`.
     * Tool calls use it, so they work without a listening server.
     */
    let appFetch: ((request: Request) => Promise<Response>) | null = null

    /**
     * Base URL of a listening server. Used when `setServerBaseUrl` was called,
     * or when the hooks are driven by hand without `AdapterContext.fetch`.
     */
    let serverBaseUrl: string | null = null
    let baseUrlOverride = false

    /** Join a module mount path with the route-level sub-path. */
    const joinMountPath = (mountPath: string, routePath: string): string => {
      const base = mountPath.endsWith('/') ? mountPath.slice(0, -1) : mountPath
      if (!routePath || routePath === '/') return base
      const sub = routePath.startsWith('/') ? routePath : `/${routePath}`
      return `${base}${sub}`
    }

    /** Build an AiToolDefinition for a route decorated with @AiTool. */
    const tryBuildTool = (
      controller: Constructor,
      mountPath: string,
      route: RouteDefinition,
    ): AiToolDefinition | null => {
      const decorated = getAiToolMeta(controller.prototype, route.handlerName)
      const flags = getRouteFlags(controller, route.handlerName)
      const flagRoute = {
        method: route.method.toUpperCase(),
        path: joinMountPath(mountPath, route.path),
        controller,
        handlerName: route.handlerName,
      }

      // hideWhen wins over @AiTool and exposeWhen.
      if (options.hideWhen && matchesFlagTest(options.hideWhen, flags, flagRoute)) return null
      const flagged =
        options.exposeWhen !== undefined && matchesFlagTest(options.exposeWhen, flags, flagRoute)
      const meta: Partial<AiToolOptions> | undefined =
        decorated ?? (flagged ? flagToolOptions(options.exposeWhen!, flags) : undefined)
      if (!meta) return null

      const handler = `${controller.name}.${route.handlerName}`
      const name = toolNameFor(meta.name ?? `${controller.name}_${route.handlerName}`, handler)
      const fullPath = joinMountPath(mountPath, route.path)

      // Path params, query and body side by side, from any schema library.
      let routeTool: RouteTool
      try {
        routeTool = buildRouteTool({
          method: route.method,
          path: fullPath,
          params: route.validation?.params,
          query: route.validation?.query,
          body: route.validation?.body,
          input: meta.inputSchema,
        })
      } catch (err) {
        log.error(err as Error, `AiAdapter: cannot build a tool for ${handler}; not exposed`)
        return null
      }
      if (routeTools.has(name)) {
        log.error(
          `AiAdapter: duplicate tool name "${name}" (${handler}); not exposed. ` +
            `Give one of them @AiTool({ name }).`,
        )
        return null
      }
      routeTools.set(name, routeTool)

      return {
        name,
        description:
          meta.description ??
          `${route.method.toUpperCase()} ${fullPath} (${controller.name}.${route.handlerName})`,
        inputSchema: routeTool.inputSchema,
        httpMethod: route.method.toUpperCase(),
        mountPath: fullPath,
      }
    }

    /** Resolve the running server's base URL from a Node http.Server instance. */
    const resolveServerBaseUrl = (server: AdapterContext['server']): string | null => {
      if (!server) return null
      const address = server.address()
      if (!address || typeof address === 'string') return null
      let host = address.address
      if (host === '::' || host === '0.0.0.0' || host === '') host = '127.0.0.1'
      if (host.includes(':') && !host.startsWith('[')) host = `[${host}]`
      return `http://${host}:${address.port}`
    }

    /** Expand an agent `tools` option to an explicit array. */
    const resolveTools = (spec: 'auto' | ChatToolDefinition[]): ChatToolDefinition[] => {
      if (spec === 'auto') return tools
      return spec
    }

    /**
     * Dispatch a single tool call through the app's own pipeline —
     * middleware, validation, contributors, guards, error handling — as a
     * request to the tool's route, with the caller's headers and signal.
     */
    const dispatchToolCall = async (
      call: { id: string; name: string; arguments: Record<string, unknown> },
      caller: { headers?: Headers | Record<string, string>; signal?: AbortSignal },
    ): Promise<ChatMessage> => {
      const tool = tools.find((t) => t.name === call.name)
      if (!tool) {
        return {
          role: 'tool',
          toolCallId: call.id,
          content: JSON.stringify({ error: `Tool not found: ${call.name}` }),
        }
      }
      const useBaseUrl = baseUrlOverride || !appFetch
      if (useBaseUrl && !serverBaseUrl) {
        return {
          role: 'tool',
          toolCallId: call.id,
          content: JSON.stringify({
            error: `Cannot dispatch ${call.name}: the adapter has not started`,
          }),
        }
      }

      const routeTool =
        routeTools.get(tool.name) ??
        buildRouteTool({ method: tool.httpMethod, path: tool.mountPath })
      let request: ReturnType<RouteTool['toRequest']>
      try {
        request = routeTool.toRequest(call.arguments ?? {})
      } catch (err) {
        return {
          role: 'tool',
          toolCallId: call.id,
          content: JSON.stringify({ error: (err as Error).message }),
        }
      }

      const headers = new Headers(caller.headers)
      headers.set('accept', 'application/json')
      headers.set('x-ai-tool', tool.name)
      const init: RequestInit = {
        method: tool.httpMethod.toUpperCase(),
        headers,
        signal: caller.signal,
      }
      if (request.body !== undefined) {
        headers.set('content-type', 'application/json')
        init.body = JSON.stringify(request.body)
      }

      try {
        const res = useBaseUrl
          ? await fetch(`${serverBaseUrl}${request.url}`, init)
          : await appFetch!(new Request(new URL(request.url, 'http://localhost'), init))
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

    /** Public: Run a tool-calling agent loop. */
    const runAgent = async (agentOptions: RunAgentOptions): Promise<RunAgentResult> => {
      const maxSteps = agentOptions.maxSteps ?? 8
      const resolvedTools = resolveTools(agentOptions.tools ?? 'auto')

      const messages: ChatMessage[] = [...agentOptions.messages]
      let steps = 0
      const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

      for (let i = 0; i < maxSteps; i++) {
        steps++

        const response = await provider.chat(
          {
            messages,
            model: agentOptions.model,
            tools: resolvedTools.length > 0 ? resolvedTools : undefined,
          },
          {
            temperature: agentOptions.temperature,
            maxTokens: agentOptions.maxTokens,
            topP: agentOptions.topP,
            stopSequences: agentOptions.stopSequences,
            signal: agentOptions.signal,
          },
        )

        if (response.usage) {
          usage.promptTokens += response.usage.promptTokens
          usage.completionTokens += response.usage.completionTokens
          usage.totalTokens += response.usage.totalTokens
        }

        if (!response.toolCalls || response.toolCalls.length === 0) {
          messages.push({ role: 'assistant', content: response.content })
          return {
            content: response.content,
            messages,
            steps,
            usage: usage.totalTokens > 0 ? usage : undefined,
          }
        }

        messages.push({
          role: 'assistant',
          content: response.content,
          toolCalls: response.toolCalls,
        })

        const results = await Promise.all(
          response.toolCalls.map((call) =>
            dispatchToolCall(call, { headers: agentOptions.headers, signal: agentOptions.signal }),
          ),
        )
        for (const result of results) {
          messages.push(result)
        }
      }

      const lastAssistant = messages
        .slice()
        .toReversed()
        .find((m) => m.role === 'assistant')
      return {
        content: lastAssistant?.content ?? '',
        messages,
        steps,
        usage: usage.totalTokens > 0 ? usage : undefined,
        maxStepsReached: true,
      }
    }

    /** Public: Memory-aware agent turn. */
    const runAgentWithMemory = async (
      memoryOptions: RunAgentWithMemoryOptions,
    ): Promise<RunAgentResult> => {
      const history = await memoryOptions.memory.get()
      const messages: ChatMessage[] = [...history]

      const isFirstTurn = messages.length === 0
      if (isFirstTurn && memoryOptions.systemPrompt) {
        const systemMessage: ChatMessage = { role: 'system', content: memoryOptions.systemPrompt }
        messages.push(systemMessage)
        await memoryOptions.memory.add(systemMessage)
      }

      const userMessage: ChatMessage = { role: 'user', content: memoryOptions.userMessage }
      messages.push(userMessage)
      await memoryOptions.memory.add(userMessage)

      const result = await runAgent({
        messages,
        model: memoryOptions.model,
        tools: memoryOptions.tools,
        maxSteps: memoryOptions.maxSteps,
        temperature: memoryOptions.temperature,
        maxTokens: memoryOptions.maxTokens,
        topP: memoryOptions.topP,
        stopSequences: memoryOptions.stopSequences,
        signal: memoryOptions.signal,
        headers: memoryOptions.headers,
      })

      const newMessages = result.messages.slice(messages.length)
      const toPersist = memoryOptions.persistToolResults
        ? newMessages
        : newMessages.filter((m) => m.role !== 'tool')
      if (toPersist.length > 0) {
        await memoryOptions.memory.add(toPersist)
      }

      return result
    }

    // Pre-build the public surface so we can register the adapter
    // instance under AI_ADAPTER inside `beforeStart` without depending
    // on `this`. The factory's mutate-name pattern means lifecycle
    // hooks don't have a stable `this` reference to the returned
    // adapter object.
    const publicSurface: AiAdapterExtensions = {
      getProvider: () => provider,
      getTools: () => tools,
      setServerBaseUrl: (url) => {
        serverBaseUrl = url
        baseUrlOverride = url !== null
      },
      runAgent,
      runAgentWithMemory,
    }

    return {
      ...publicSurface,

      onRouteMount(controller, mountPath) {
        mountedControllers.push({ controller, mountPath })
      },

      beforeStart({ container, fetch: contextFetch }) {
        appFetch = contextFetch ?? null
        container.registerFactory(AI_PROVIDER, () => provider, Scope.SINGLETON)
        container.registerInstance(AI_ADAPTER, publicSurface)

        for (const { controller, mountPath } of mountedControllers) {
          const routes = getClassMeta<RouteDefinition[]>(METADATA.ROUTES, controller, [])
          for (const route of routes) {
            const tool = tryBuildTool(controller, mountPath, route)
            if (tool) tools.push(tool)
          }
        }

        log.info(`AiAdapter ready — provider: ${provider.name}, ${tools.length} tool(s) discovered`)
      },

      afterStart(ctx) {
        appFetch ??= ctx.fetch ?? null
        if (!baseUrlOverride) serverBaseUrl = resolveServerBaseUrl(ctx.server)
      },

      /**
       * Forgets discovered tools too, so an instance started again (HMR,
       * `Application.rebuild()`) rediscovers them instead of listing each
       * one twice.
       */
      async shutdown() {
        serverBaseUrl = null
        baseUrlOverride = false
        appFetch = null
        tools.length = 0
        routeTools.clear()
        mountedControllers.length = 0
        log.debug('AiAdapter shutdown complete')
      },
    }
  },
})
