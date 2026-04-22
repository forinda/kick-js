import { randomUUID } from 'node:crypto'
import {
  Logger,
  METADATA,
  defineAdapter,
  getClassMeta,
  type AdapterContext,
  type Constructor,
  type RouteDefinition,
} from '@forinda/kickjs'
import type { Express } from 'express'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { getMcpToolMeta } from './decorators'
import { zodToJsonSchema } from './zod-to-json-schema'
import type { McpAdapterOptions, McpToolDefinition, McpTransport } from './types'

const log = Logger.for('McpAdapter')

/**
 * Public extension surface exposed by an McpAdapter instance.
 * `getTools()` lets test suites and the `kick mcp --list` command
 * inspect the tool definitions discovered during startup.
 */
export interface McpAdapterExtensions {
  /**
   * Return the list of tools discovered during startup.
   *
   * Primary consumers:
   *   - the `kick mcp --list` command
   *   - unit tests that verify a route was exposed as expected
   */
  getTools(): readonly McpToolDefinition[]

  /**
   * Dispatch a tool call through the Express pipeline. **Internal — not
   * part of the public API.** Tests reach in here to verify the dispatch
   * path without going through the MCP SDK transport. Production code
   * should never call this directly; the MCP SDK calls it for you when
   * a client invokes a registered tool.
   *
   * @internal
   */
  dispatchTool(
    tool: McpToolDefinition,
    args: unknown,
    extra?: unknown,
  ): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>
}

/**
 * Expose a KickJS application as a Model Context Protocol (MCP) server.
 *
 * The adapter implements `onRouteMount` to collect every registered
 * controller alongside its mount path. During `beforeStart` (after all
 * modules have finished mounting), it walks the collected controllers,
 * reads route metadata via `getClassMeta(METADATA.ROUTES, ...)`, and
 * builds a `McpToolDefinition[]` that the MCP SDK will register as
 * callable tools.
 *
 * The input schema of each tool is the JSON Schema equivalent of the
 * route's Zod `body` schema, converted via the package's own
 * `zod-to-json-schema` helper. Tools with no body schema get an empty
 * object schema so the model can still call them with no arguments.
 *
 * @example
 * ```ts
 * import { bootstrap } from '@forinda/kickjs'
 * import { McpAdapter } from '@forinda/kickjs-mcp'
 * import { modules } from './modules'
 *
 * export const app = await bootstrap({
 *   modules,
 *   adapters: [
 *     McpAdapter({
 *       name: 'task-api',
 *       version: '1.0.0',
 *       description: 'Task management MCP server',
 *       mode: 'explicit',
 *       transport: 'sse',
 *     }),
 *   ],
 * })
 * ```
 */
export const McpAdapter = defineAdapter<McpAdapterOptions, McpAdapterExtensions>({
  name: 'McpAdapter',
  defaults: {
    mode: 'explicit',
    transport: 'sse',
    basePath: '/_mcp',
    version: '0.0.0',
  },
  build: (options) => {
    /** Controllers collected during the mount phase, in insertion order. */
    const mountedControllers: Array<{ controller: Constructor; mountPath: string }> = []

    /** Discovered tool definitions, built during `beforeStart`. */
    const tools: McpToolDefinition[] = []

    /** Active MCP server instance, created in `afterStart`. */
    let mcpServer: McpServer | null = null

    /**
     * Active MCP transport, created in `afterStart`. Can be either a
     * `StreamableHTTPServerTransport` (the default for HTTP-based MCP)
     * or a `StdioServerTransport` (when running via the `kick mcp` CLI
     * or with `KICK_MCP_STDIO=1`).
     */
    let transport: Transport | null = null

    /**
     * Base URL of the running KickJS HTTP server, captured in `afterStart`
     * once the server is listening. Tool dispatch makes internal HTTP
     * requests against this base URL so calls flow through the normal
     * Express pipeline (middleware, validation, auth, logging, error
     * handling) rather than bypassing it.
     */
    let serverBaseUrl: string | null = null

    /**
     * Decide which transport to actually start. Precedence: an explicit
     * `KICK_MCP_STDIO=1` environment variable always wins, because that's
     * how the `kick mcp` CLI command tells the running process to switch
     * to stdio mode without requiring the user to edit their bootstrap.
     */
    const resolveTransportMode = (): McpTransport => {
      if (process.env.KICK_MCP_STDIO === '1' || process.env.KICK_MCP_STDIO === 'true') {
        return 'stdio'
      }
      return options.transport!
    }

    /** Default description for routes exposed in `auto` mode without explicit @McpTool. */
    const deriveDescription = (controller: Constructor, route: RouteDefinition): string =>
      `${route.method.toUpperCase()} handler ${controller.name}.${route.handlerName}`

    /** Join module mount path with the route-level sub-path. */
    const joinMountPath = (mountPath: string, routePath: string): string => {
      const base = mountPath.endsWith('/') ? mountPath.slice(0, -1) : mountPath
      if (!routePath || routePath === '/') return base
      const sub = routePath.startsWith('/') ? routePath : `/${routePath}`
      return `${base}${sub}`
    }

    /** Build a McpToolDefinition for one route, or null if it should be skipped. */
    const tryBuildTool = (
      controller: Constructor,
      mountPath: string,
      route: RouteDefinition,
    ): McpToolDefinition | null => {
      const meta = getMcpToolMeta(controller.prototype, route.handlerName)

      if (options.mode === 'explicit' && !meta) return null
      if (meta?.hidden) return null

      if (options.mode === 'auto') {
        const methodUpper = route.method.toUpperCase() as
          | 'GET'
          | 'POST'
          | 'PUT'
          | 'PATCH'
          | 'DELETE'
        if (options.include && !options.include.includes(methodUpper)) return null
        if (options.exclude?.some((prefix) => mountPath.startsWith(prefix))) return null
      }

      const description = meta?.description ?? deriveDescription(controller, route)
      const name = meta?.name ?? `${controller.name}.${route.handlerName}`

      // Prefer the body schema for POST/PUT/PATCH, query schema for GET/DELETE.
      // In `auto` mode the decorator may be absent entirely, in which case we
      // fall back to whatever schema the route decorator declared.
      const candidateSchema = meta?.inputSchema ?? route.validation?.body ?? route.validation?.query

      const inputSchema = zodToJsonSchema(candidateSchema) ?? {
        type: 'object',
        properties: {},
        additionalProperties: false,
      }

      const outputSchema = meta?.outputSchema ? zodToJsonSchema(meta.outputSchema) : undefined

      return {
        name,
        description,
        inputSchema,
        // Keep the original Zod schema alongside the JSON Schema. The MCP
        // SDK accepts Zod directly via `registerTool`, while `inputSchema`
        // (above) is what `getTools()` and inspection surfaces consume.
        zodInputSchema: candidateSchema,
        outputSchema: outputSchema ?? undefined,
        httpMethod: route.method.toUpperCase(),
        mountPath: joinMountPath(mountPath, route.path),
        examples: meta?.examples,
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

    /** Substitute Express-style path parameters with values from args. */
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

    /** Extract the Authorization header from MCP SDK extra context. */
    const extractAuthToken = (extra: unknown): string | null => {
      if (!extra || typeof extra !== 'object') return null
      const info = (extra as Record<string, unknown>).requestInfo
      if (!info || typeof info !== 'object') return null
      const headers = (info as Record<string, unknown>).headers
      if (!headers || typeof headers !== 'object') return null
      if (headers instanceof Map) return headers.get('authorization') ?? null
      if (typeof (headers as Record<string, unknown>).get === 'function') {
        return (headers as { get: (k: string) => string | null }).get('authorization')
      }
      return (headers as Record<string, string>).authorization ?? null
    }

    /**
     * Dispatch a tool call through the Express pipeline. Builds an HTTP
     * request matching the tool's underlying route and sends it to the
     * captured serverBaseUrl. Auth headers from the MCP transport
     * request flow through to the internal dispatch so MCP tool calls
     * respect the same auth middleware as direct HTTP.
     */
    const dispatchTool = async (
      tool: McpToolDefinition,
      rawArgs: unknown,
      extra?: unknown,
    ): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> => {
      if (!serverBaseUrl) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: `Cannot dispatch ${tool.name}: HTTP server address not yet captured`,
            },
          ],
        }
      }

      const args = (rawArgs ?? {}) as Record<string, unknown>
      const { path, remainingArgs } = substitutePathParams(tool.mountPath, args)
      const method = tool.httpMethod.toUpperCase()
      const hasBody = method === 'POST' || method === 'PUT' || method === 'PATCH'

      const forwardedHeaders: Record<string, string> = {
        accept: 'application/json',
        'x-mcp-tool': tool.name,
      }
      const authToken = extractAuthToken(extra)
      if (authToken) {
        forwardedHeaders.authorization = authToken
      }

      let url = `${serverBaseUrl}${path}`
      const init: RequestInit = {
        method,
        headers: forwardedHeaders,
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
        return {
          isError: res.status >= 400,
          content: [{ type: 'text' as const, text: text || `(${res.status} ${res.statusText})` }],
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        log.error(err as Error, `McpAdapter: dispatch failed for ${tool.name}`)
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `Tool dispatch error: ${message}` }],
        }
      }
    }

    /**
     * Construct the underlying McpServer and register every discovered
     * tool against it. The SDK accepts Zod schemas natively, so we pass
     * `zodInputSchema` straight through. Tool calls dispatch through
     * the Express pipeline via internal HTTP requests against the
     * running server's address.
     */
    const buildMcpServer = (): McpServer => {
      const server = new McpServer({
        name: options.name,
        version: options.version!,
        ...(options.description ? { description: options.description } : {}),
      })

      // The SDK's `registerTool` is heavily overloaded with deep generic
      // inference over Zod input/output shapes. Cast through `any` once
      // here so the call sites stay clean.
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const registerTool = server.registerTool.bind(server) as (
        name: string,
        config: { description: string; inputSchema?: unknown },
        cb: (args: unknown) => any,
      ) => unknown
      /* eslint-enable @typescript-eslint/no-explicit-any */

      for (const tool of tools) {
        const config: { description: string; inputSchema?: unknown } = {
          description: tool.description,
        }
        if (tool.zodInputSchema) {
          config.inputSchema = tool.zodInputSchema
        }
        registerTool(tool.name, config, async (args: unknown) => dispatchTool(tool, args))
      }

      return server
    }

    /** Mount StreamableHTTP transport endpoints on the existing Express app. */
    const mountHttpRoutes = (app: Express, httpTransport: StreamableHTTPServerTransport): void => {
      const path = `${options.basePath!}/messages`

      /* eslint-disable @typescript-eslint/no-explicit-any */
      const handleRequest = async (req: any, res: any): Promise<void> => {
        try {
          await httpTransport.handleRequest(req, res, req.body)
        } catch (err) {
          log.error(err as Error, `McpAdapter: error handling ${req.method} ${path}`)
          if (!res.headersSent) {
            res.status(500).json({ error: 'MCP transport error' })
          }
        }
      }
      /* eslint-enable @typescript-eslint/no-explicit-any */

      app.post(path, handleRequest)
      app.get(path, handleRequest)
      app.delete(path, handleRequest)
    }

    /**
     * Start the MCP server bound to process stdio. Used by the `kick mcp`
     * CLI: the parent process pipes its stdin/stdout to this adapter so
     * MCP clients (Claude Code, Cursor) can speak the protocol over the
     * wire. Logs MUST go to stderr in this mode.
     */
    const startStdioTransport = async (): Promise<void> => {
      mcpServer = buildMcpServer()
      transport = new StdioServerTransport()
      await mcpServer.connect(transport)
      log.info(
        `McpAdapter ready (stdio) — ${tools.length} tool(s) registered, dispatching against ${serverBaseUrl ?? 'unknown'}`,
      )
    }

    return {
      getTools(): readonly McpToolDefinition[] {
        return tools
      },

      dispatchTool,

      /**
       * Called by the framework each time a module mounts a controller.
       * We don't inspect routes here — we just record the pair and process
       * everything in `beforeStart` once mounting is fully complete.
       */
      onRouteMount(controller, mountPath) {
        mountedControllers.push({ controller, mountPath })
      },

      /**
       * Walk collected controllers, read route metadata, and materialize
       * `McpToolDefinition[]`. Runs after every module has mounted but
       * before the HTTP server starts listening.
       */
      beforeStart() {
        for (const { controller, mountPath } of mountedControllers) {
          const routes = getClassMeta<RouteDefinition[]>(METADATA.ROUTES, controller, [])
          for (const route of routes) {
            const tool = tryBuildTool(controller, mountPath, route)
            if (tool) tools.push(tool)
          }
        }

        log.debug(
          `MCP adapter discovered ${tools.length} tool(s) ` +
            `(mode=${options.mode}, transport=${options.transport})`,
        )
      },

      /**
       * Start the MCP server on the configured transport.
       *
       * - `http` (recommended): mounts a `StreamableHTTPServerTransport` on
       *   the existing Express app at `${basePath}/messages`.
       * - `sse` (deprecated): currently aliases to `http` and emits a warning.
       * - `stdio`: skipped here. The standalone `kick mcp` CLI command
       *   instantiates the adapter directly and connects it to a stdio
       *   transport so dev logs don't interfere.
       */
      async afterStart(ctx) {
        serverBaseUrl = resolveServerBaseUrl(ctx.server)

        const effectiveTransport = resolveTransportMode()

        if (effectiveTransport === 'stdio') {
          await startStdioTransport()
          return
        }

        if (effectiveTransport === 'sse') {
          log.warn(
            'sse transport is deprecated upstream; using StreamableHTTP transport, which supports the same SSE wire format under the hood',
          )
        }

        const expressApp = ctx.app as Express | undefined
        if (!expressApp) {
          log.warn('McpAdapter: AdapterContext.app is unavailable, cannot mount HTTP transport')
          return
        }

        mcpServer = buildMcpServer()
        const httpTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
        })
        transport = httpTransport

        await mcpServer.connect(httpTransport)
        mountHttpRoutes(expressApp, httpTransport)

        log.info(
          `McpAdapter ready — ${tools.length} tool(s) registered, listening at ${options.basePath}/messages`,
        )
      },

      /** Tear down the MCP server and any open transports. Idempotent. */
      async shutdown() {
        try {
          await transport?.close()
        } catch (err) {
          log.error(err as Error, 'McpAdapter: failed to close transport')
        }
        try {
          await mcpServer?.close()
        } catch (err) {
          log.error(err as Error, 'McpAdapter: failed to close server')
        }
        transport = null
        mcpServer = null
        serverBaseUrl = null
        log.debug('McpAdapter shutdown complete')
      },
    }
  },
})
