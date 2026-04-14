import { randomUUID } from 'node:crypto'
import {
  Logger,
  METADATA,
  getClassMeta,
  type AppAdapter,
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
 *     new McpAdapter({
 *       name: 'task-api',
 *       version: '1.0.0',
 *       description: 'Task management MCP server',
 *       mode: 'explicit',
 *       transport: 'sse',
 *     }),
 *   ],
 * })
 * ```
 *
 * @remarks
 * Tool discovery is complete. The remaining work for v1 is wiring the
 * generated tool definitions to `@modelcontextprotocol/sdk` in
 * `afterStart` — see the TODO markers in that hook. Until then,
 * `getTools()` returns the discovered definitions so tests can assert
 * the scan produced the expected shape.
 */
export class McpAdapter implements AppAdapter {
  readonly name = 'McpAdapter'

  private readonly options: Required<
    Pick<McpAdapterOptions, 'mode' | 'transport' | 'basePath' | 'version'>
  > &
    McpAdapterOptions

  /** Controllers collected during the mount phase, in insertion order. */
  private readonly mountedControllers: Array<{
    controller: Constructor
    mountPath: string
  }> = []

  /** Discovered tool definitions, built during `beforeStart`. */
  private readonly tools: McpToolDefinition[] = []

  /** Active MCP server instance, created in `afterStart`. */
  private mcpServer: McpServer | null = null

  /**
   * Active MCP transport, created in `afterStart`. Can be either a
   * `StreamableHTTPServerTransport` (the default for HTTP-based MCP)
   * or a `StdioServerTransport` (when running via the `kick mcp` CLI
   * or with `KICK_MCP_STDIO=1`).
   */
  private transport: Transport | null = null

  /**
   * Base URL of the running KickJS HTTP server, captured in `afterStart`
   * once the server is listening. Tool dispatch makes internal HTTP
   * requests against this base URL so calls flow through the normal
   * Express pipeline (middleware, validation, auth, logging, error
   * handling) rather than bypassing it.
   *
   * Format: `http://127.0.0.1:<port>`. Set to `null` until afterStart
   * runs and reset to `null` on shutdown.
   */
  private serverBaseUrl: string | null = null

  constructor(options: McpAdapterOptions) {
    this.options = {
      mode: options.mode ?? 'explicit',
      transport: options.transport ?? 'sse',
      basePath: options.basePath ?? '/_mcp',
      version: options.version ?? '0.0.0',
      ...options,
    }
  }

  /**
   * Called by the framework each time a module mounts a controller.
   *
   * We don't inspect routes here — we just record the pair and process
   * everything in `beforeStart` once mounting is fully complete. This
   * keeps the scan logic in one place and makes it easier to unit test.
   */
  onRouteMount(controller: Constructor, mountPath: string): void {
    this.mountedControllers.push({ controller, mountPath })
  }

  /**
   * Walk collected controllers, read route metadata, and materialize
   * `McpToolDefinition[]`.
   *
   * Runs after every module has mounted but before the HTTP server
   * starts listening, so the MCP server can be initialized in
   * `afterStart` with a complete tool list.
   */
  beforeStart(_ctx: AdapterContext): void {
    for (const { controller, mountPath } of this.mountedControllers) {
      const routes = getClassMeta<RouteDefinition[]>(METADATA.ROUTES, controller, [])
      for (const route of routes) {
        const tool = this.tryBuildTool(controller, mountPath, route)
        if (tool) this.tools.push(tool)
      }
    }

    log.debug(
      `MCP adapter discovered ${this.tools.length} tool(s) ` +
        `(mode=${this.options.mode}, transport=${this.options.transport})`,
    )
  }

  /**
   * Start the MCP server on the configured transport.
   *
   * - `http` (recommended): mounts a `StreamableHTTPServerTransport` on
   *   the existing Express app at `${basePath}/messages`. This is the
   *   modern, spec-compliant way to expose MCP over HTTP.
   * - `sse` (deprecated): currently aliases to `http` and emits a warning.
   *   The MCP SSE transport class is deprecated upstream in favor of
   *   StreamableHTTP, which already supports SSE-style streaming under
   *   the hood.
   * - `stdio`: skipped here. The standalone `kick mcp` CLI command
   *   instantiates the adapter directly and connects it to a stdio
   *   transport so dev logs don't interfere.
   */
  async afterStart(ctx: AdapterContext): Promise<void> {
    // Capture the running server's address so tool dispatch can make
    // internal HTTP requests against the actual port. The framework
    // calls afterStart only once the server is listening, so
    // server.address() returns a real AddressInfo at this point.
    // We capture this regardless of transport mode because dispatch
    // always uses the local HTTP listener — even in stdio mode it's
    // the internal route into the Express pipeline.
    this.serverBaseUrl = this.resolveServerBaseUrl(ctx.server)

    const effectiveTransport = this.resolveTransportMode()

    if (effectiveTransport === 'stdio') {
      await this.startStdioTransport()
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

    this.mcpServer = this.buildMcpServer()
    const httpTransport = new StreamableHTTPServerTransport({
      // Stateless mode for v0 — every request gets a fresh session. We can
      // switch to a stateful generator (sessionIdGenerator: randomUUID) once
      // we add session-aware tool dispatch.
      sessionIdGenerator: () => randomUUID(),
    })
    this.transport = httpTransport

    await this.mcpServer.connect(httpTransport)
    this.mountHttpRoutes(expressApp, httpTransport)

    log.info(
      `McpAdapter ready — ${this.tools.length} tool(s) registered, listening at ${this.options.basePath}/messages`,
    )
  }

  /**
   * Decide which transport to actually start.
   *
   * Precedence: an explicit `KICK_MCP_STDIO=1` environment variable
   * always wins, because that's how the `kick mcp` CLI command tells
   * the running process to switch to stdio mode without requiring the
   * user to edit their bootstrap. Otherwise the constructor option is
   * honored as-is.
   */
  private resolveTransportMode(): McpTransport {
    if (process.env.KICK_MCP_STDIO === '1' || process.env.KICK_MCP_STDIO === 'true') {
      return 'stdio'
    }
    return this.options.transport
  }

  /**
   * Start the MCP server bound to process stdio.
   *
   * Used by the `kick mcp` CLI: the parent process pipes its stdin/
   * stdout to this adapter so MCP clients (Claude Code, Cursor) can
   * speak the protocol over the wire. Logs MUST go to stderr in this
   * mode — anything written to stdout corrupts the JSON-RPC stream.
   *
   * The HTTP server is still running (the framework called start()
   * before afterStart), but we don't mount the MCP routes on it. Tool
   * dispatch routes through fetch against `serverBaseUrl` exactly the
   * same way it does in HTTP mode, so dispatch behavior is uniform
   * across transports.
   */
  private async startStdioTransport(): Promise<void> {
    this.mcpServer = this.buildMcpServer()
    this.transport = new StdioServerTransport()
    await this.mcpServer.connect(this.transport)
    // Use stderr-friendly log level so we don't break the protocol
    log.info(
      `McpAdapter ready (stdio) — ${this.tools.length} tool(s) registered, dispatching against ${this.serverBaseUrl ?? 'unknown'}`,
    )
  }

  /**
   * Tear down the MCP server and any open transports.
   *
   * Called during graceful shutdown. Idempotent — KickJS may invoke
   * `shutdown` more than once under error conditions.
   */
  async shutdown(): Promise<void> {
    try {
      await this.transport?.close()
    } catch (err) {
      log.error(err as Error, 'McpAdapter: failed to close transport')
    }
    try {
      await this.mcpServer?.close()
    } catch (err) {
      log.error(err as Error, 'McpAdapter: failed to close server')
    }
    this.transport = null
    this.mcpServer = null
    this.serverBaseUrl = null
    log.debug('McpAdapter shutdown complete')
  }

  /**
   * Return the list of tools discovered during startup.
   *
   * Primary consumers:
   *   - the `kick mcp --list` command
   *   - unit tests that verify a route was exposed as expected
   */
  getTools(): readonly McpToolDefinition[] {
    return this.tools
  }

  // ── Internal helpers ───────────────────────────────────────────────

  /**
   * Build a `McpToolDefinition` for a single route, or return `null`
   * if the route should be skipped under the current exposure mode.
   *
   * Scoping rules:
   *   - `explicit` (default): only routes with `@McpTool` are exposed
   *   - `auto`: every route is exposed, filtered by `include` /
   *     `exclude`; a `hidden: true` on `@McpTool` still drops the route
   */
  private tryBuildTool(
    controller: Constructor,
    mountPath: string,
    route: RouteDefinition,
  ): McpToolDefinition | null {
    const meta = getMcpToolMeta(controller.prototype, route.handlerName)

    if (this.options.mode === 'explicit' && !meta) return null
    if (meta?.hidden) return null

    if (this.options.mode === 'auto') {
      const methodUpper = route.method.toUpperCase() as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
      if (this.options.include && !this.options.include.includes(methodUpper)) return null
      if (this.options.exclude?.some((prefix) => mountPath.startsWith(prefix))) return null
    }

    const description = meta?.description ?? this.deriveDescription(controller, route)
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
      mountPath: this.joinMountPath(mountPath, route.path),
      examples: meta?.examples,
    }
  }

  /**
   * Derive a default description for routes exposed in `auto` mode
   * without an explicit `@McpTool` decorator. Kept intentionally
   * generic — teams running `auto` should still add `@McpTool` with
   * real descriptions for any tool the model is expected to call
   * reliably.
   */
  private deriveDescription(controller: Constructor, route: RouteDefinition): string {
    return `${route.method.toUpperCase()} handler ${controller.name}.${route.handlerName}`
  }

  /**
   * Join a module mount path with the route-level sub-path.
   *
   * Mount path already includes the API prefix + version (e.g.
   * `/api/v1/tasks`); the route-level `path` is relative (e.g. `/:id`).
   * Trailing/leading slashes are normalized so the final URL is stable.
   */
  private joinMountPath(mountPath: string, routePath: string): string {
    const base = mountPath.endsWith('/') ? mountPath.slice(0, -1) : mountPath
    if (!routePath || routePath === '/') return base
    const sub = routePath.startsWith('/') ? routePath : `/${routePath}`
    return `${base}${sub}`
  }

  /**
   * Construct the underlying `McpServer` and register every discovered
   * tool against it. The SDK accepts Zod schemas natively, so we pass
   * `zodInputSchema` straight through and skip the JSON Schema form
   * here (the JSON Schema is for inspection / docs).
   *
   * Tool calls dispatch through the Express pipeline via internal HTTP
   * requests against the running server's address (captured in
   * `afterStart`). This preserves middleware, validation, auth, and
   * logging — tool calls behave exactly like external HTTP requests
   * to the same route.
   */
  private buildMcpServer(): McpServer {
    const server = new McpServer({
      name: this.options.name,
      version: this.options.version,
      ...(this.options.description ? { description: this.options.description } : {}),
    })

    // The SDK's `registerTool` is heavily overloaded with deep generic
    // inference over Zod input/output shapes. The McpToolDefinition
    // intentionally types `zodInputSchema` as `unknown` to keep our
    // public surface free of SDK internal types, which makes the
    // overload picker unhappy. Cast through `any` once, here, so the
    // call sites stay clean. The SDK validates the schema at register
    // time anyway, so the `any` is bounded to this loop.
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const registerTool = server.registerTool.bind(server) as (
      name: string,
      config: { description: string; inputSchema?: unknown },
      cb: (args: unknown) => any,
    ) => unknown
    /* eslint-enable @typescript-eslint/no-explicit-any */

    for (const tool of this.tools) {
      const config: { description: string; inputSchema?: unknown } = {
        description: tool.description,
      }
      if (tool.zodInputSchema) {
        config.inputSchema = tool.zodInputSchema
      }
      registerTool(tool.name, config, async (args, extra) => this.dispatchTool(tool, args, extra))
    }

    return server
  }

  /**
   * Dispatch a tool call through the Express pipeline.
   *
   * Builds an HTTP request that matches the tool's underlying route
   * (method + path + body or query string from the args) and sends it
   * to the running server's `serverBaseUrl`. The request goes through
   * every middleware the route normally hits — auth, validation,
   * logging, error handling — so tool calls observe exactly the same
   * guarantees as external HTTP clients.
   *
   * Path parameters (e.g. `/:id`) are substituted from `args` before
   * the request fires; matching keys are removed from the body/query
   * to avoid sending them twice.
   *
   * Returns a `CallToolResult` whose `content` contains the response
   * body as text. Non-2xx responses are flagged with `isError: true`
   * so the calling LLM can react.
   */
  /**
   * Dispatch a tool call through the Express pipeline.
   *
   * @param tool - The tool definition
   * @param rawArgs - Arguments from the MCP client
   * @param extra - Optional MCP SDK extra context (contains request info for auth forwarding)
   */
  private async dispatchTool(
    tool: McpToolDefinition,
    rawArgs: unknown,
    extra?: unknown,
  ): Promise<{
    content: Array<{ type: 'text'; text: string }>
    isError?: boolean
  }> {
    if (!this.serverBaseUrl) {
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
    const { path, remainingArgs } = this.substitutePathParams(tool.mountPath, args)
    const method = tool.httpMethod.toUpperCase()
    const hasBody = method === 'POST' || method === 'PUT' || method === 'PATCH'

    // Forward auth headers from the MCP transport request to the internal dispatch.
    // This ensures tool calls through MCP respect the same auth middleware as direct HTTP.
    const forwardedHeaders: Record<string, string> = {
      accept: 'application/json',
      'x-mcp-tool': tool.name,
    }
    const authToken = this.extractAuthToken(extra)
    if (authToken) {
      forwardedHeaders.authorization = authToken
    }

    let url = `${this.serverBaseUrl}${path}`
    const init: RequestInit = {
      method,
      headers: forwardedHeaders,
    }

    if (hasBody) {
      ;(init.headers as Record<string, string>)['content-type'] = 'application/json'
      init.body = JSON.stringify(remainingArgs)
    } else if (Object.keys(remainingArgs).length > 0) {
      // GET / DELETE: serialize args as a query string
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
        content: [
          {
            type: 'text' as const,
            text: text || `(${res.status} ${res.statusText})`,
          },
        ],
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error(err as Error, `McpAdapter: dispatch failed for ${tool.name}`)
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: `Tool dispatch error: ${message}`,
          },
        ],
      }
    }
  }

  /**
   * Extract the Authorization header from the MCP SDK extra context.
   * The StreamableHTTPServerTransport passes the original request headers
   * in `extra.requestInfo.headers`, allowing us to forward auth tokens
   * through to the internal HTTP dispatch.
   */
  private extractAuthToken(extra: unknown): string | null {
    if (!extra || typeof extra !== 'object') return null
    const info = (extra as Record<string, unknown>).requestInfo
    if (!info || typeof info !== 'object') return null
    const headers = (info as Record<string, unknown>).headers
    if (!headers || typeof headers !== 'object') return null
    // Support both Map-like and plain object headers
    if (headers instanceof Map) return headers.get('authorization') ?? null
    if (typeof (headers as Record<string, unknown>).get === 'function') {
      return (headers as { get: (k: string) => string | null }).get('authorization')
    }
    return (headers as Record<string, string>).authorization ?? null
  }

  /**
   * Substitute Express-style path parameters (`:id`) in `mountPath`
   * with values from `args`. Returns the resolved path plus the args
   * that were NOT consumed by parameters, so they can be sent as the
   * request body or query string.
   *
   * If a `:param` is referenced in the path but missing from args,
   * the placeholder is left in place — the request will hit a 404 from
   * the underlying route, which is reported back as an MCP error.
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
   * instance. Returns null if the server isn't listening or its
   * address can't be determined (e.g. when the adapter is mounted
   * standalone for testing).
   *
   * IPv6 addresses are wrapped in brackets per RFC 3986. The hostname
   * `0.0.0.0` (Linux default) is rewritten to `127.0.0.1` because the
   * former is not a valid request target on all platforms.
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

  /**
   * Mount the StreamableHTTP transport endpoints on the existing
   * Express app. The transport handles three HTTP verbs at a single
   * URL:
   *   - POST: client → server messages (initialize, tool calls, etc.)
   *   - GET:  server → client SSE stream for notifications
   *   - DELETE: client tells the server to terminate a session
   *
   * We mount all three on `${basePath}/messages` so a single URL is
   * the entire MCP surface area.
   */
  private mountHttpRoutes(app: Express, transport: StreamableHTTPServerTransport): void {
    const path = `${this.options.basePath}/messages`

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const handleRequest = async (req: any, res: any): Promise<void> => {
      try {
        await transport.handleRequest(req, res, req.body)
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
}
