import { randomUUID } from 'node:crypto'
import {
  Logger,
  METADATA,
  defineAdapter,
  getClassMeta,
  getRouteFlags,
  matchesFlagTest,
  type AdapterContext,
  type AdapterHttp,
  type Constructor,
  type RequestContext,
  type RouteDefinition,
  type RouteFlagTest,
  type RouteFlags,
  type RouteEntry,
  type RouteMethod,
} from '@forinda/kickjs'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  isInitializeRequest,
} from '@modelcontextprotocol/sdk/types.js'
import { buildRouteTool, detectSchema, type RouteTool } from '@forinda/kickjs-schema'
import { getMcpToolMeta } from './decorators'
import type { McpAdapterOptions, McpToolDefinition, McpToolOptions, McpTransport } from './types'

const log = Logger.for('McpAdapter')

/** Characters and length the MCP spec allows in a tool name. */
const MCP_TOOL_NAME = /^[A-Za-z0-9_.-]{1,128}$/

/** A valid MCP tool name, replacing any other character with `_`. */
function toolNameFor(name: string, handler: string): string {
  if (MCP_TOOL_NAME.test(name)) return name
  const cleaned = name.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 128) || '_'
  log.warn(`McpAdapter: tool name "${name}" (${handler}) is not valid for MCP; using "${cleaned}"`)
  return cleaned
}

/**
 * Tool options carried by a flag named in `exposeWhen`: the value of the
 * first such flag the route carries that is an object, e.g.
 * `@Tool({ description: '…' })` for `defineRouteFlag<McpToolOptions>('…')`.
 * Predicates and negated names name no flag, so they carry no options.
 */
function flagToolOptions(test: RouteFlagTest, flags: RouteFlags): Partial<McpToolOptions> {
  const names = (typeof test === 'string' ? [test] : Array.isArray(test) ? test : []).filter(
    (name: string) => !name.startsWith('!'),
  )
  for (const name of names) {
    const value = flags.get(name)
    if (value && typeof value === 'object') return value as Partial<McpToolOptions>
  }
  return {}
}

/** First value of a node header that may repeat. */
function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/** Send a JSON-RPC error on any runtime. */
function sendJsonRpcError(
  ctx: RequestContext,
  status: number,
  message: string,
  headers: Record<string, string> = {},
): Promise<void> {
  return ctx.sendResponse(
    new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    }),
  )
}

/** Headers copied from the MCP request onto tool calls by default. */
const DEFAULT_FORWARD_HEADERS = [
  'authorization',
  'cookie',
  'x-request-id',
  'traceparent',
  'tracestate',
]

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
 * Each tool's input schema combines the route's path parameters and its
 * `query` and `body` schemas, from any library `@forinda/kickjs-schema`
 * supports. Tools with no inputs get an empty object schema.
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
    // A mixed-polarity list fails here, where the adapter is configured,
    // not later inside startup where the error would be swallowed.
    if (options.exposeWhen) matchesFlagTest(options.exposeWhen, undefined)
    if (options.hideWhen) matchesFlagTest(options.hideWhen, undefined)

    /** Controllers collected during the mount phase, in insertion order. */
    const mountedControllers: Array<{ controller: Constructor; mountPath: string }> = []

    /** Discovered tool definitions, built during `beforeStart`. */
    const tools: McpToolDefinition[] = []

    /** Input schema + argument-to-request mapping per tool name. */
    const routeTools = new Map<string, RouteTool>()

    /** Stdio MCP server instance, created in `afterStart`. */
    let mcpServer: Server | null = null

    /**
     * Stdio transport, created in `afterStart` when running via the
     * `kick mcp` CLI or with `KICK_MCP_STDIO=1`. HTTP clients each get
     * their own transport in `sessions`.
     */
    let transport: Transport | null = null

    /**
     * Open Streamable HTTP sessions, keyed by `mcp-session-id`. Each client
     * gets its own MCP server + transport: one shared transport accepts a
     * single `initialize` for the life of the process.
     */
    const sessions = new Map<
      string,
      { server: Server; transport: WebStandardStreamableHTTPServerTransport }
    >()

    /**
     * Runs a Request through this app's pipeline, from `AdapterContext.fetch`.
     * Tool calls use it, so they work without a listening server.
     */
    let appFetch: ((request: Request) => Promise<Response>) | null = null

    /**
     * Base URL of a listening server, captured in `afterStart`. Only used
     * when the adapter's hooks are driven by hand without
     * `AdapterContext.fetch` (older setups, unit tests).
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
      const decorated = getMcpToolMeta(controller.prototype, route.handlerName)
      const flags = getRouteFlags(controller, route.handlerName)
      const flagRoute = {
        method: route.method.toUpperCase(),
        path: joinMountPath(mountPath, route.path),
        controller,
        handlerName: route.handlerName,
      }

      // hideWhen wins over @McpTool, exposeWhen and auto mode.
      if (options.hideWhen && matchesFlagTest(options.hideWhen, flags, flagRoute)) return null
      const flagged =
        options.exposeWhen !== undefined && matchesFlagTest(options.exposeWhen, flags, flagRoute)
      const meta: Partial<McpToolOptions> | undefined =
        decorated ?? (flagged ? flagToolOptions(options.exposeWhen!, flags) : undefined)

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
      const handler = `${controller.name}.${route.handlerName}`
      const name = toolNameFor(meta?.name ?? handler, handler)
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
          input: meta?.inputSchema,
        })
      } catch (err) {
        log.error(err as Error, `McpAdapter: cannot build a tool for ${handler}; not exposed`)
        return null
      }
      if (routeTools.has(name)) {
        log.error(
          `McpAdapter: duplicate tool name "${name}" (${handler}); not exposed. ` +
            `Give one of them @McpTool({ name }).`,
        )
        return null
      }
      routeTools.set(name, routeTool)

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
        inputSchema: routeTool.inputSchema,
        outputSchema: outputSchema ?? undefined,
        httpMethod: route.method.toUpperCase(),
        mountPath: fullPath,
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

    /** A header from the MCP request that carried a tool call. */
    const requestHeader = (extra: unknown, name: string): string | undefined => {
      const headers = (extra as { requestInfo?: { headers?: unknown } } | undefined)?.requestInfo
        ?.headers
      if (!headers || typeof headers !== 'object') return undefined
      if (typeof (headers as Headers).get === 'function') {
        return (headers as Headers).get(name) ?? undefined
      }
      const value = (headers as Record<string, string | string[] | undefined>)[name]
      return Array.isArray(value) ? value.join(', ') : value
    }

    /**
     * Dispatch a tool call through the app's own pipeline — middleware,
     * validation, contributors, guards, error handling — as a request to the
     * tool's route. Headers in `forwardHeaders` are copied from the MCP
     * request, and the client's cancellation aborts the call.
     */
    const dispatchTool = async (
      tool: McpToolDefinition,
      rawArgs: unknown,
      extra?: unknown,
    ): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> => {
      const errorResult = (text: string) => ({
        isError: true,
        content: [{ type: 'text' as const, text }],
      })
      if (!appFetch && !serverBaseUrl) {
        return errorResult(`Cannot dispatch ${tool.name}: the adapter has not started`)
      }

      // Tools built during discovery carry their schemas; a hand-built
      // definition gets the path-parameter mapping only.
      const routeTool =
        routeTools.get(tool.name) ??
        buildRouteTool({ method: tool.httpMethod, path: tool.mountPath })
      let target: ReturnType<RouteTool['toRequest']>
      try {
        target = routeTool.toRequest((rawArgs ?? {}) as Record<string, unknown>)
      } catch (err) {
        return errorResult((err as Error).message)
      }

      const headers = new Headers({ accept: 'application/json', 'x-mcp-tool': tool.name })
      for (const name of options.forwardHeaders ?? DEFAULT_FORWARD_HEADERS) {
        const value = requestHeader(extra, name.toLowerCase())
        if (value !== undefined) headers.set(name, value)
      }
      const init: RequestInit = {
        method: tool.httpMethod.toUpperCase(),
        headers,
        signal: (extra as { signal?: AbortSignal } | undefined)?.signal,
      }
      if (target.body !== undefined) {
        headers.set('content-type', 'application/json')
        init.body = JSON.stringify(target.body)
      }

      try {
        const res = appFetch
          ? await appFetch(new Request(new URL(target.url, 'http://localhost'), init))
          : await fetch(`${serverBaseUrl}${target.url}`, init)
        const text = await res.text()
        return {
          isError: res.status >= 400,
          content: [{ type: 'text' as const, text: text || `(${res.status} ${res.statusText})` }],
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        log.error(err as Error, `McpAdapter: dispatch failed for ${tool.name}`)
        return errorResult(`Tool dispatch error: ${message}`)
      }
    }

    /**
     * Construct an MCP server that lists every discovered tool and
     * dispatches calls through the HTTP pipeline, where the route's own
     * validation checks the arguments.
     *
     * Uses the SDK's low-level `Server` (marked deprecated only in favour of
     * `McpServer` for simple cases): `McpServer.registerTool` accepts Zod
     * schemas only, and tools here carry JSON Schema built from any schema
     * library.
     */
    const buildMcpServer = (): Server => {
      const server = new Server(
        {
          name: options.name,
          version: options.version!,
          ...(options.description ? { description: options.description } : {}),
        },
        { capabilities: { tools: {} } },
      )

      server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema as { type: 'object' },
        })),
      }))

      server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
        const tool = tools.find((t) => t.name === request.params.name)
        if (!tool) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: `Unknown tool: ${request.params.name}` }],
          }
        }
        return dispatchTool(tool, request.params.arguments ?? {}, extra)
      })

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

    /** Mount the Streamable HTTP endpoint via the engine-agnostic HTTP facade. */
    const mountHttpRoutes = (http: AdapterHttp): void => {
      const path = `${options.basePath!}/messages`

      // The SDK's web-standard transport takes a Request and returns a
      // Response. Building the Request from `ctx.req` (method, url, headers —
      // present on every runtime) and sending the Response with
      // `ctx.sendResponse` keeps the endpoint independent of the HTTP engine.
      const handleRequest = async (ctx: RequestContext): Promise<void> => {
        const req = ctx.req as {
          method?: string
          url?: string
          headers: Record<string, string | string[] | undefined>
        }
        try {
          const denied = await checkAccess(req.headers)
          if (denied) {
            await sendJsonRpcError(ctx, denied.status, denied.message, denied.headers)
            return
          }

          const headers = new Headers()
          for (const [name, value] of Object.entries(req.headers)) {
            if (value !== undefined)
              headers.set(name, Array.isArray(value) ? value.join(', ') : value)
          }
          const webRequest = new Request(new URL(req.url ?? path, 'http://localhost'), {
            method: req.method ?? 'POST',
            headers,
            signal: ctx.signal,
          })
          const parsedBody = webRequest.method === 'POST' ? ctx.body : undefined

          const sessionId = firstHeader(req.headers['mcp-session-id'])
          if (sessionId) {
            const session = sessions.get(sessionId)
            if (!session) {
              await sendJsonRpcError(ctx, 404, 'Session not found')
              return
            }
            await ctx.sendResponse(
              await session.transport.handleRequest(webRequest, { parsedBody }),
            )
            return
          }

          if (webRequest.method !== 'POST' || !isInitializeRequest(parsedBody)) {
            await sendJsonRpcError(ctx, 400, 'Bad Request: no valid session ID provided')
            return
          }

          // ponytail: sessions live until the client sends DELETE, disconnects,
          // or the app shuts down; add an idle timeout if abandoned sessions pile up.
          const server = buildMcpServer()
          const sessionTransport = new WebStandardStreamableHTTPServerTransport({
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
          await ctx.sendResponse(await sessionTransport.handleRequest(webRequest, { parsedBody }))
        } catch (err) {
          log.error(err as Error, `McpAdapter: error handling ${req.method} ${path}`)
          if (!ctx.res.headersSent) await sendJsonRpcError(ctx, 500, 'MCP transport error')
        }
      }

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
        appFetch = ctx.fetch ?? null
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
        appFetch ??= ctx.fetch ?? null
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
        appFetch = null
        tools.length = 0
        routeTools.clear()
        mountedControllers.length = 0
        log.debug('McpAdapter shutdown complete')
      },
    }
  },
})
