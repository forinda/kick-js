import {
  Logger,
  METADATA,
  getClassMeta,
  type AppAdapter,
  type AdapterContext,
  type Constructor,
  type RouteDefinition,
} from '@forinda/kickjs'
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
   * - `stdio`: typically handled by a separate `kick mcp` entrypoint,
   *   since stdio conflicts with dev-server logs if run in-process.
   * - `sse` / `http`: mount on the existing Express app at `basePath`
   *   (default `/_mcp`).
   */
  async afterStart(_ctx: AdapterContext): Promise<void> {
    // TODO: Instantiate `Server` from `@modelcontextprotocol/sdk/server`
    // and register each of `this.tools` via `server.setRequestHandler`.
    //
    // For `sse`: use `SSEServerTransport` and mount
    //   app.get(`${basePath}/sse`, ...)
    //   app.post(`${basePath}/messages`, ...)
    //
    // For `http`: use `StreamableHTTPServerTransport` mounted on a
    //   single POST endpoint.
    //
    // For `stdio`: skip Express entirely (handled by the CLI command).

    log.info(
      `McpAdapter ready — ${this.tools.length} tool(s) registered (mode=${this.options.mode})`,
    )
  }

  /**
   * Tear down the MCP server and any open transports.
   *
   * Called during graceful shutdown. Idempotent — KickJS may invoke
   * `shutdown` more than once under error conditions.
   */
  async shutdown(): Promise<void> {
    // TODO: Close the MCP server and any open SSE connections.
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
}
