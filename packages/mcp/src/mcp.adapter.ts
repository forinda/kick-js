import { randomUUID } from 'node:crypto'
import {
  Logger,
  METADATA,
  defineAdapter,
  getClassMeta,
  type AdapterContext,
  type AdapterHttp,
  type Constructor,
  type RequestContext,
  type RouteDefinition,
  type RouteEntry,
  type RouteMethod,
} from '@forinda/kickjs'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { detectSchema } from '@forinda/kickjs-schema'
import { getMcpToolMeta } from './decorators'
import type { McpAdapterOptions, McpToolDefinition, McpTransport } from './types'

const log = Logger.for('McpAdapter')

/** First value of a node header that may repeat. */
function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/** Write a JSON-RPC error straight to the node response. */
function sendJsonRpcError(
  res: {
    writeHead(status: number, headers: Record<string, string>): unknown
    end(body: string): unknown
  },
  status: number,
  message: string,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }))
}

/**
 * Whether an `exclude` pattern matches a route path. Patterns are compared
 * against the full path and every trailing part of it that starts at a `/`,
 * so `'/admin/*'` matches `/api/v1/admin/users` without knowing the api
 * prefix. `*` matches anything; a trailing `/*` also matches the bare path;
 * a pattern without `*` matches that path and everything under it. Errs
 * toward excluding more, never less.
 */
export function matchesPathPattern(path: string, pattern: string): boolean {
  const parts = path.split('/')
  const candidates = parts.map((_, i) => `/${parts.slice(i + 1).join('/')}`)
  let test: (candidate: string) => boolean
  if (pattern.includes('*')) {
    // A trailing `/*` also matches the bare path: '/admin/*' excludes '/admin'.
    const trailing = pattern.endsWith('/*')
    const body = trailing ? pattern.slice(0, -2) : pattern
    const source =
      body.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + (trailing ? '(?:/.*)?' : '')
    const regex = new RegExp(`^${source}$`)
    test = (candidate) => regex.test(candidate)
  } else {
    const base = pattern.endsWith('/') ? pattern.slice(0, -1) : pattern
    test = (candidate) => candidate === base || candidate.startsWith(`${base}/`)
  }
  return candidates.some(test)
}

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
     * Stdio transport, created in `afterStart` when running via the
     * `kick mcp` CLI or with `KICK_MCP_STDIO=1`. HTTP clients each get
     * their own transport in `sessions`.
     */
    let transport: Transport | null = null

    /**
     * Open Streamable HTTP sessions, keyed by `mcp-session-id`. Each client
     * gets its own McpServer + transport: one shared transport accepts a
     * single `initialize` for the life of the process.
     */
    const sessions = new Map<
      string,
      { server: McpServer; transport: StreamableHTTPServerTransport }
    >()

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
        const fullPath = joinMountPath(mountPath, route.path)
        if (options.exclude?.some((pattern) => matchesPathPattern(fullPath, pattern))) return null
      }

      const description = meta?.description ?? deriveDescription(controller, route)
      const name = meta?.name ?? `${controller.name}.${route.handlerName}`

      // Prefer the body schema for POST/PUT/PATCH, query schema for GET/DELETE.
      // In `auto` mode the decorator may be absent entirely, in which case we
      // fall back to whatever schema the route decorator declared.
      const candidateSchema = meta?.inputSchema ?? route.validation?.body ?? route.validation?.query

      let inputSchema: Record<string, unknown>
      let resolvedZodInput: unknown = candidateSchema
      try {
        const wrapped = candidateSchema ? detectSchema(candidateSchema) : undefined
        inputSchema = wrapped?.toJsonSchema() ?? {
          type: 'object',
          properties: {},
          additionalProperties: false,
        }
      } catch {
        inputSchema = { type: 'object', properties: {}, additionalProperties: false }
        resolvedZodInput = undefined
      }

      let outputSchema: Record<string, unknown> | undefined
      if (meta?.outputSchema) {
        try {
          outputSchema = detectSchema(meta.outputSchema).toJsonSchema()
        } catch {
          outputSchema = undefined
        }
      }

      return {
        name,
        description,
        inputSchema,
        zodInputSchema: resolvedZodInput,
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
        cb: (args: unknown, extra: unknown) => any,
      ) => unknown
      /* eslint-enable @typescript-eslint/no-explicit-any */

      for (const tool of tools) {
        const config: { description: string; inputSchema?: unknown } = {
          description: tool.description,
        }
        if (tool.zodInputSchema) {
          config.inputSchema = tool.zodInputSchema
          registerTool(tool.name, config, async (args: unknown, extra: unknown) =>
            dispatchTool(tool, args, extra),
          )
        } else {
          registerTool(tool.name, config, async (extra: unknown) => dispatchTool(tool, {}, extra))
        }
      }

      return server
    }

    /**
     * Origin and auth checks for one HTTP request. Returns the rejection to
     * send, or null to let the request through.
     *
     * Origin: browsers send it, MCP clients (Claude Code, Cursor, the SDK) do
     * not. A request that carries one must match `allowedOrigins` — the MCP
     * spec requires this to stop DNS-rebinding attacks from web pages.
     */
    const checkAccess = async (
      headers: Record<string, string | string[] | undefined>,
    ): Promise<{ status: number; message: string; headers?: Record<string, string> } | null> => {
      const origin = firstHeader(headers.origin)
      const allowedOrigins = options.allowedOrigins ?? []
      if (origin && !allowedOrigins.includes('*') && !allowedOrigins.includes(origin)) {
        return { status: 403, message: `Forbidden: origin ${origin} is not allowed` }
      }

      if (!options.auth) return null
      const authorization = firstHeader(headers.authorization) ?? ''
      const credential =
        options.auth.type === 'bearer'
          ? (/^Bearer\s+(.+)$/i.exec(authorization)?.[1] ?? '')
          : authorization
      let allowed = false
      if (options.auth.type === 'custom' || credential !== '') {
        try {
          allowed = Boolean(await options.auth.validate(credential))
        } catch (err) {
          log.error(err as Error, 'McpAdapter: auth.validate threw; rejecting the request')
        }
      }
      if (allowed) return null
      return {
        status: 401,
        message: 'Unauthorized',
        ...(options.auth.type === 'bearer' ? { headers: { 'www-authenticate': 'Bearer' } } : {}),
      }
    }

    /** Mount StreamableHTTP transport endpoints via the HTTP facade. */
    const mountHttpRoutes = (http: AdapterHttp): void => {
      const path = `${options.basePath!}/messages`

      // The MCP transport reads/writes the raw node request/response directly,
      // so reach through to `ctx.req` / `ctx.res` (engine-native under Express).
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const handleRequest = async (ctx: RequestContext): Promise<void> => {
        const req = ctx.req as any
        const res = ctx.res as any
        try {
          const denied = await checkAccess(req.headers)
          if (denied) {
            sendJsonRpcError(res, denied.status, denied.message, denied.headers)
            return
          }

          const sessionId = firstHeader(req.headers['mcp-session-id'])
          if (sessionId) {
            const session = sessions.get(sessionId)
            if (!session) {
              sendJsonRpcError(res, 404, 'Session not found')
              return
            }
            await session.transport.handleRequest(req, res, req.body)
            return
          }

          if (req.method !== 'POST' || !isInitializeRequest(req.body)) {
            sendJsonRpcError(res, 400, 'Bad Request: no valid session ID provided')
            return
          }

          // ponytail: sessions live until the client sends DELETE, disconnects,
          // or the app shuts down; add an idle timeout if abandoned sessions pile up.
          const server = buildMcpServer()
          const sessionTransport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id) => {
              sessions.set(id, { server, transport: sessionTransport })
            },
          })
          // Set before connect(): the SDK wraps an existing onclose, but a
          // handler assigned afterwards would replace its cleanup.
          // oxlint-disable-next-line unicorn/prefer-add-event-listener -- MCP SDK transports expose only an `onclose` property
          sessionTransport.onclose = () => {
            if (sessionTransport.sessionId) sessions.delete(sessionTransport.sessionId)
          }
          await server.connect(sessionTransport)
          await sessionTransport.handleRequest(req, res, req.body)
        } catch (err) {
          log.error(err as Error, `McpAdapter: error handling ${req.method} ${path}`)
          if (!res.headersSent) {
            res.status(500).json({ error: 'MCP transport error' })
          }
        }
      }
      /* eslint-enable @typescript-eslint/no-explicit-any */

      // Mount all three verbs in a single table so they share one router —
      // this is what lets the engine auto-answer the OPTIONS preflight with the
      // correct Allow header (separate `route()` calls would each get their own
      // router and the preflight wouldn't aggregate).
      const makeEntry = (method: RouteMethod): RouteEntry => ({
        method,
        path,
        middlewares: [],
        contributorRunner: null,
        handler: handleRequest,
        meta: {},
      })
      http.mount('/', [makeEntry('POST'), makeEntry('GET'), makeEntry('DELETE')])
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
       * Walk collected controllers, materialize tool defs, and (for
       * HTTP transports) mount the `/_mcp/messages` Express routes.
       *
       * Mounting happens here — not in `afterStart` — because by the
       * time `afterStart` fires, the Application has already attached
       * its `notFoundHandler` to the express stack. notFoundHandler is
       * a catch-all that never calls `next()`, so any route registered
       * after it gets pre-empted with a 404. `beforeStart` runs before
       * the framework adds the error handlers (kickjs ≥5.12.2), which
       * is the only window where mount order is correct.
       *
       * The stdio path stays in `afterStart` because it doesn't touch
       * the Express stack at all.
       */
      async beforeStart(ctx) {
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

        const effectiveTransport = resolveTransportMode()
        if (effectiveTransport === 'stdio') return

        if (effectiveTransport === 'sse') {
          log.warn(
            'sse transport is deprecated upstream; using StreamableHTTP transport, which supports the same SSE wire format under the hood',
          )
        }

        if (!ctx.http) {
          log.warn('McpAdapter: AdapterContext.http is unavailable, cannot mount HTTP transport')
          return
        }

        mountHttpRoutes(ctx.http)
      },

      /**
       * Capture the running server's base URL (only available after
       * the HTTP server is listening), and for stdio transports build
       * and connect the MCP server. HTTP routes were already mounted
       * in `beforeStart` so they land ahead of the catch-all 404.
       */
      async afterStart(ctx) {
        serverBaseUrl = resolveServerBaseUrl(ctx.server)

        const effectiveTransport = resolveTransportMode()

        if (effectiveTransport === 'stdio') {
          await startStdioTransport()
          return
        }

        log.info(
          `McpAdapter ready — ${tools.length} tool(s) registered, listening at ${options.basePath}/messages`,
        )
      },

      /**
       * Tear down the MCP servers and every open transport. Idempotent.
       * Also forgets discovered tools, so an instance started again (HMR,
       * `Application.rebuild()`) rediscovers them instead of registering
       * each one twice.
       */
      async shutdown() {
        const open = [...sessions.values()]
        sessions.clear()
        const servers = [...open.map((s) => s.server), ...(mcpServer ? [mcpServer] : [])]
        for (const server of servers) {
          try {
            await server.close()
          } catch (err) {
            log.error(err as Error, 'McpAdapter: failed to close server')
          }
        }
        try {
          await transport?.close()
        } catch (err) {
          log.error(err as Error, 'McpAdapter: failed to close transport')
        }
        transport = null
        mcpServer = null
        serverBaseUrl = null
        tools.length = 0
        mountedControllers.length = 0
        log.debug('McpAdapter shutdown complete')
      },
    }
  },
})
