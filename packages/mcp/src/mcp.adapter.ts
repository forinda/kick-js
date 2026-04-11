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
import { getMcpToolMeta } from './decorators'
import { zodToJsonSchema } from './zod-to-json-schema'
import type { McpAdapterOptions, McpToolDefinition } from './types'

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
  private tools: McpToolDefinition[] = []

  /** Active MCP server instance, created in `afterStart`. */
  private mcpServer: McpServer | null = null

  /** Active streamable HTTP transport, created in `afterStart`. */
  private transport: StreamableHTTPServerTransport | null = null

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
    if (this.options.transport === 'stdio') {
      log.debug('Stdio transport requested — skipping in-process Express mount')
      return
    }

    if (this.options.transport === 'sse') {
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
    this.transport = new StreamableHTTPServerTransport({
      // Stateless mode for v0 — every request gets a fresh session. We can
      // switch to a stateful generator (sessionIdGenerator: randomUUID) once
      // we add session-aware tool dispatch.
      sessionIdGenerator: () => randomUUID(),
    })

    await this.mcpServer.connect(this.transport)
    this.mountHttpRoutes(expressApp)

    log.info(
      `McpAdapter ready — ${this.tools.length} tool(s) registered, listening at ${this.options.basePath}/messages`,
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
   * The tool dispatch callback is a placeholder for v0: it returns a
   * structured "not yet wired" response so MCP clients can discover
   * tools and exercise the protocol round-trip without crashing. Real
   * dispatch (resolving the controller from the DI container and
   * invoking the handler through the Express pipeline) is the next
   * iteration.
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
      registerTool(tool.name, config, async (args) => this.placeholderToolResponse(tool.name, args))
    }

    return server
  }

  /**
   * Placeholder tool response used until real dispatch is wired.
   *
   * Returns a structured `CallToolResult` so MCP clients see the tool
   * existed and was called, but learn that dispatch is not yet implemented.
   * The next iteration replaces this with a real call into the Express
   * pipeline (resolving the controller from the DI container or making
   * an internal HTTP request to the route's mountPath).
   */
  private placeholderToolResponse(toolName: string, args: unknown) {
    return {
      content: [
        {
          type: 'text' as const,
          text:
            `Tool ${toolName} was called but dispatch is not yet wired. ` +
            `Arguments received: ${JSON.stringify(args ?? {})}`,
        },
      ],
    }
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
  private mountHttpRoutes(app: Express): void {
    const transport = this.transport
    if (!transport) return

    const path = `${this.options.basePath}/messages`

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

    app.post(path, handleRequest)
    app.get(path, handleRequest)
    app.delete(path, handleRequest)
  }
}
