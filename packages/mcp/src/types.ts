import type { ZodTypeAny } from 'zod'

/**
 * Transport modes supported by the MCP adapter.
 *
 * - `stdio` — standard MCP transport for CLI clients (Claude Code, Cursor).
 *   The MCP server owns stdin/stdout. Cannot be combined with a normal
 *   Express dev server in the same process without care.
 * - `sse` — Server-Sent Events over HTTP. Good fit when KickJS already
 *   exposes an HTTP server — the MCP endpoints mount on the same app.
 * - `http` — plain HTTP POST/GET streaming. Simpler than SSE for some
 *   clients but gives up live notifications.
 */
export type McpTransport = 'stdio' | 'sse' | 'http'

/**
 * How the adapter decides which endpoints become MCP tools.
 *
 * - `explicit` (default) — only methods decorated with `@McpTool` are
 *   exposed. Safest default; prevents accidental exposure of internal
 *   endpoints or admin routes.
 * - `auto` — every route discovered at startup becomes a tool, subject
 *   to the `include` / `exclude` filters. Use with care in production.
 */
export type McpExposureMode = 'explicit' | 'auto'

/**
 * Authentication configuration for the MCP transport.
 *
 * For `stdio`, auth is usually not needed (client and server share a
 * process). For `sse` and `http`, set this so the adapter refuses
 * unauthenticated tool calls.
 */
export interface McpAuthOptions {
  /** Strategy to use. `bearer` reads `Authorization: Bearer <token>`. */
  type: 'bearer' | 'custom'
  /** Called on every tool invocation. Return true (or truthy data) to allow. */
  validate: (token: string) => boolean | Promise<boolean>
}

/**
 * Options for the `McpAdapter` constructor.
 *
 * @example
 * ```ts
 * new McpAdapter({
 *   name: 'task-api',
 *   version: '1.0.0',
 *   description: 'Task management MCP server',
 *   mode: 'explicit',
 *   transport: 'sse',
 * })
 * ```
 */
export interface McpAdapterOptions {
  /** MCP server name advertised to clients. Usually matches package.json name. */
  name: string
  /** Server version advertised to clients. Defaults to '0.0.0' if omitted. */
  version?: string
  /** Human-readable description shown in MCP client UIs. */
  description?: string
  /** Exposure mode. Defaults to `'explicit'`. */
  mode?: McpExposureMode
  /** Transport mode. Defaults to `'sse'`. */
  transport?: McpTransport
  /** HTTP methods to include when `mode === 'auto'`. */
  include?: Array<'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'>
  /** Glob-style path prefixes to exclude when `mode === 'auto'`. */
  exclude?: string[]
  /** Auth config for `sse` and `http` transports. */
  auth?: McpAuthOptions
  /** Base path for the MCP endpoint (SSE/HTTP only). Defaults to `/_mcp`. */
  basePath?: string
}

/**
 * Example input/output pair shown alongside a tool description.
 *
 * Models can use examples to learn the expected shape of arguments and
 * what a successful call returns. Keep examples small and representative.
 */
export interface McpToolExample {
  /** Natural-language description of what this example does. */
  description?: string
  /** Arguments to pass to the tool. Must match the Zod input schema. */
  args: Record<string, unknown>
  /** Expected result shape. Used in docs only — not validated. */
  result?: unknown
}

/**
 * Options for the `@McpTool` decorator.
 *
 * @example
 * ```ts
 * @Post('/', { body: createTaskSchema, name: 'CreateTask' })
 * @McpTool({
 *   description: 'Create a new task',
 *   examples: [{ args: { title: 'Ship v3', priority: 'high' } }],
 * })
 * create(ctx: Ctx<KickRoutes.TaskController['create']>) {}
 * ```
 */
export interface McpToolOptions {
  /**
   * Override the tool name. Defaults to `<ControllerName>.<methodName>`.
   * Tool names must be unique across the entire MCP server.
   */
  name?: string
  /**
   * Human-readable description of what the tool does. Shown to the LLM
   * when it decides whether to call this tool. Be specific: "Create a
   * task" is less useful than "Create a new task with the given title,
   * priority, and optional assignee".
   */
  description: string
  /**
   * Optional input schema override. If omitted, the adapter derives
   * the input schema from the route's `body` Zod schema (if any).
   */
  inputSchema?: ZodTypeAny
  /**
   * Optional output schema for documentation. Not validated at runtime.
   */
  outputSchema?: ZodTypeAny
  /** Optional usage examples shown in the tool description. */
  examples?: McpToolExample[]
  /**
   * When set to `true`, exclude this tool from any `auto` exposure mode
   * filter. Useful to mark admin-only routes inside otherwise-exposed
   * controllers.
   */
  hidden?: boolean
}

/**
 * Resolved tool definition after scanning decorators at startup.
 *
 * This is the shape the adapter hands to the MCP SDK when registering
 * tools. Users don't construct this directly — it's derived from
 * `@McpTool` metadata plus route metadata from `@Controller`.
 */
export interface McpToolDefinition {
  /** Resolved tool name (either from options.name or derived). */
  name: string
  /** Human-readable description. */
  description: string
  /** JSON Schema for tool inputs, derived from the Zod body schema. */
  inputSchema: Record<string, unknown>
  /** Optional JSON Schema for tool outputs. */
  outputSchema?: Record<string, unknown>
  /** HTTP method of the underlying route. */
  httpMethod: string
  /** Full mount path of the underlying route (after apiPrefix + version). */
  mountPath: string
  /** Examples for documentation. */
  examples?: McpToolExample[]
}
