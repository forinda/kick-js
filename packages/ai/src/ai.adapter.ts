import {
  Logger,
  METADATA,
  Scope,
  defineAdapter,
  getClassMeta,
  type AdapterContext,
  type Constructor,
  type RouteDefinition,
} from '@forinda/kickjs'
import { AI_ADAPTER, AI_PROVIDER } from './constants'
import { getAiToolMeta } from './decorators'
import type { RunAgentWithMemoryOptions } from './memory/types'
import { zodToJsonSchema } from './zod-to-json-schema'
import type {
  AiAdapterExtensions,
  AiAdapterOptions,
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
    const provider = options.provider

    /** Controllers collected during the mount phase, in insertion order. */
    const mountedControllers: Array<{ controller: Constructor; mountPath: string }> = []

    /** Tool definitions built during `beforeStart` from `@AiTool` metadata. */
    const tools: AiToolDefinition[] = []

    /** Base URL of the running KickJS HTTP server, captured in `afterStart`. */
    let serverBaseUrl: string | null = null

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
        mountPath: joinMountPath(mountPath, route.path),
      }
    }

    /** Substitute Express-style :param placeholders with values from args. */
    const substitutePathParams = (
      mountPath: string,
      args: Record<string, unknown>,
    ): { path: string; remainingArgs: Record<string, unknown> } => {
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

    /** Dispatch a single tool call through the Express pipeline. */
    const dispatchToolCall = async (call: {
      id: string
      name: string
      arguments: Record<string, unknown>
    }): Promise<ChatMessage> => {
      const tool = tools.find((t) => t.name === call.name)
      if (!tool) {
        return {
          role: 'tool',
          toolCallId: call.id,
          content: JSON.stringify({ error: `Tool not found: ${call.name}` }),
        }
      }
      if (!serverBaseUrl) {
        return {
          role: 'tool',
          toolCallId: call.id,
          content: JSON.stringify({
            error: `Cannot dispatch ${call.name}: HTTP server address not yet captured`,
          }),
        }
      }

      const args = call.arguments ?? {}
      const { path, remainingArgs } = substitutePathParams(tool.mountPath, args)
      const method = tool.httpMethod.toUpperCase()
      const hasBody = method === 'POST' || method === 'PUT' || method === 'PATCH'

      let url = `${serverBaseUrl}${path}`
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

        const results = await Promise.all(response.toolCalls.map((call) => dispatchToolCall(call)))
        for (const result of results) {
          messages.push(result)
        }
      }

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
      },
      runAgent,
      runAgentWithMemory,
    }

    return {
      ...publicSurface,

      onRouteMount(controller, mountPath) {
        mountedControllers.push({ controller, mountPath })
      },

      beforeStart({ container }) {
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
        serverBaseUrl = resolveServerBaseUrl(ctx.server)
        log.debug(`AiAdapter agent dispatch target: ${serverBaseUrl ?? '(unknown)'}`)
      },

      async shutdown() {
        serverBaseUrl = null
        log.debug('AiAdapter shutdown complete')
      },
    }
  },
})
