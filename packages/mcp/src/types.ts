import type { RouteFlagTest } from '@forinda/kickjs'

/**
 * Transport modes supported by the MCP adapter.
 *
 * - `http` (default) — Streamable HTTP, the current MCP transport. The
 *   endpoint mounts on the app at `basePath` and streams responses and
 *   notifications over SSE when the client asks for it.
 * - `stdio` — for clients that spawn the server (`kick mcp`, Claude Code,
 *   Cursor). The MCP server owns stdin/stdout.
 * - `sse` — deprecated alias of `http`, kept for existing configs. The old
 *   standalone SSE protocol (`GET /sse` + `POST ?sessionId`) is not served.
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
 * Who is calling: what `auth.authenticate` returns. `subject` is required;
 * the rest is whatever your tokens carry. Tool handlers read it as
 * `ctx.principal`, and `toolFilter` gets it on `call.principal`.
 */
export interface McpPrincipal {
  /** The user (or service) the token was issued to. */
  subject: string
  /** The OAuth client acting for them, when there is one. */
  clientId?: string
  /** Granted scopes, checked against a tool's `scopes`. */
  scopes?: string[]
  /**
   * The token's audience. When set, it must include this server's resource
   * URL (`call.resource`) or the request is refused with 401: a token minted
   * for one tenant's server can't be used at another's.
   */
  audience?: string | string[]
  /** Anything else your app wants on hand (tenant id, roles, …). */
  [key: string]: unknown
}

/**
 * The HTTP request a call arrived on, as auth and tool filters see it.
 */
export interface McpRequestInfo {
  /** The MCP request's headers. */
  headers: Headers
  /** The host it was addressed to — `acme.example.com`. */
  host: string
  /** Scheme and host — `https://acme.example.com`. Tool calls are sent here. */
  origin: string
  /**
   * This server's resource URL for the request: `origin` plus the endpoint
   * path. The value a token's audience should name (RFC 8707).
   */
  resource: string
}

/** What a tool filter and a tool handler know about the caller. */
export interface McpCallContext extends McpRequestInfo {
  /** Who is calling, when `auth.authenticate` is configured. */
  principal?: McpPrincipal
}

/**
 * Authentication for the HTTP transports (`sse` and `http`).
 *
 * Checked on every request to the MCP endpoint — `initialize`, `tools/list`
 * and every tool call — so a revoked token stops working mid-session.
 * Rejected requests get `401` (with a `WWW-Authenticate` challenge for
 * `bearer`). Not used for `stdio`, where client and server share a process.
 *
 * Tool calls still run through each route's own middleware and guards on
 * top of this check.
 */
export type McpAuthOptions = McpAuthCommon &
  (
    | {
        /** Return true to allow the request. A throw counts as a rejection. */
        validate: (credential: string) => boolean | Promise<boolean>
        authenticate?: never
      }
    | {
        /**
         * Return who is calling, or `null` to refuse with 401. A throw counts
         * as a refusal. Gets the request too, for the per-host resource URL a
         * token's audience is checked against.
         */
        authenticate: (
          credential: string,
          request: McpRequestInfo,
        ) => McpPrincipal | null | Promise<McpPrincipal | null>
        validate?: never
      }
  )

interface McpAuthCommon {
  /**
   * - `bearer`: the credential is the token from `Authorization: Bearer <token>`.
   *   A missing or malformed header is rejected without calling your function.
   * - `custom`: the credential is the raw `Authorization` header value
   *   (`''` when absent).
   */
  type: 'bearer' | 'custom'
  /**
   * Where clients find this server's OAuth protected-resource metadata, sent
   * as `resource_metadata` in the 401 challenge (RFC 9728). Defaults to the
   * route `protectedResource` mounts, when that is configured.
   */
  resourceMetadataUrl?: string | ((request: McpRequestInfo) => string)
  /** Scopes to name in the 401 challenge's `scope` parameter. */
  scopes?: string[]
}

/**
 * OAuth 2.0 protected-resource metadata (RFC 9728), served at
 * `/.well-known/oauth-protected-resource` and at that path plus the MCP
 * endpoint path, per host. MCP clients read it to find your authorization
 * server.
 */
export interface McpProtectedResourceOptions {
  /** Authorization server issuer URLs. A function picks them per request (per tenant). */
  authorizationServers: string[] | ((request: McpRequestInfo) => string[])
  /** Scopes this server understands. */
  scopesSupported?: string[]
  /** Overrides the `resource` value; defaults to the request's resource URL. */
  resource?: (request: McpRequestInfo) => string
}

/**
 * Hints about a tool's behaviour for clients (MCP `ToolAnnotations`). Hints,
 * not guarantees: clients use them to decide what needs a confirmation.
 */
export interface McpToolAnnotations {
  /** A display name. */
  title?: string
  /** The tool changes nothing. */
  readOnlyHint?: boolean
  /** The tool may delete or overwrite (only meaningful when not read-only). */
  destructiveHint?: boolean
  /** Calling it again with the same arguments has no further effect. */
  idempotentHint?: boolean
  /** The tool reaches outside your system (the web, a third party). */
  openWorldHint?: boolean
}

/** A tool as a filter sees it — route and custom tools alike. */
export interface McpToolSummary {
  name: string
  description: string
  /** `route` for a controller method, `custom` for a provider tool. */
  kind: 'route' | 'custom'
  /** Scopes the tool requires. */
  scopes?: string[]
  annotations?: McpToolAnnotations
  /** The route's method and path, for a route tool. */
  route?: { method: string; path: string }
  /** The provider's name, for a custom tool. */
  provider?: string
}

/**
 * Options for the `McpAdapter` constructor.
 *
 * @example
 * ```ts
 * McpAdapter({
 *   name: 'task-api',
 *   version: '1.0.0',
 *   description: 'Task management MCP server',
 *   mode: 'explicit',
 *   transport: 'http',
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
  /** Transport mode. Defaults to `'http'`. */
  transport?: McpTransport
  /** HTTP methods to include when `mode === 'auto'`. */
  include?: Array<'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'>
  /**
   * Route paths to exclude when `mode === 'auto'`. Matched against the full
   * route path and every trailing part of it, so `'/admin/*'` excludes
   * `/api/v1/admin/users` as well as `/admin`. `*` matches anything; a
   * pattern without `*` excludes that path and everything under it.
   */
  exclude?: string[]
  /** Auth config for `sse` and `http` transports. */
  auth?: McpAuthOptions
  /**
   * Browser origins allowed to call the MCP endpoint (`sse`/`http`), e.g.
   * `['https://inspector.example.com']`, or `['*']` for any.
   *
   * Requests without an `Origin` header — MCP clients such as Claude Code,
   * Cursor and the MCP SDK — are always accepted. A request that carries an
   * `Origin` not in this list gets `403`, which stops web pages from reaching
   * a local MCP server through DNS rebinding. Defaults to `[]`: no browser
   * origin is allowed.
   */
  allowedOrigins?: string[]
  /**
   * Request headers copied from the MCP request onto each tool call, so the
   * route sees the caller's credentials and tracing context. Defaults to
   * `['authorization', 'cookie', 'x-request-id', 'traceparent', 'tracestate']`.
   * Replace the list to add your own, e.g. a tenant header.
   */
  forwardHeaders?: string[]
  /**
   * Most MCP sessions open at once (`sse`/`http`). A new client beyond the
   * limit gets `503` until a session ends. Defaults to 1000.
   */
  maxSessions?: number
  /**
   * Close a session after this long with no request in progress. A client
   * holding its notification stream open is not idle. Defaults to 30 minutes.
   */
  sessionIdleTimeoutMs?: number
  /** Base path for the MCP endpoint (SSE/HTTP only). Defaults to `/_mcp`. */
  basePath?: string
  /**
   * The full endpoint path, e.g. `'/mcp'`. Defaults to `` `${basePath}/messages` ``.
   */
  path?: string
  /**
   * Serve each request with a fresh server and no session (`sse`/`http`):
   * nothing is kept between requests, so any instance behind a load balancer
   * can answer any request. `GET` and `DELETE` get 405. `maxSessions` and
   * `sessionIdleTimeoutMs` don't apply. Default `false`.
   */
  stateless?: boolean
  /**
   * Hosts the MCP endpoint answers for (`sse`/`http`) — `['acme.example.com']`,
   * or a function for a pattern (`(host) => host.endsWith('.example.com')`).
   * Any other `Host` gets 403, which completes the DNS-rebinding defence
   * `allowedOrigins` starts. Defaults to any host.
   */
  allowedHosts?: string[] | ((host: string) => boolean)
  /**
   * Believe `X-Forwarded-Proto` and `X-Forwarded-Host` from the proxy in
   * front of the app, for the request's origin and resource URL — set it
   * behind a TLS-terminating proxy, or the resource URL reads `http://`. Only
   * when that proxy overwrites those headers: otherwise a client chooses them.
   * Default `false`.
   */
  trustProxy?: boolean
  /** Serve OAuth protected-resource metadata. See {@link McpProtectedResourceOptions}. */
  protectedResource?: McpProtectedResourceOptions
  /**
   * Decide which tools a caller sees, per request. Applied to `tools/list`
   * and to `tools/call`: a tool filtered out can't be called by guessing its
   * name — the call gets the same error as an unknown tool.
   */
  toolFilter?: (tool: McpToolSummary, call: McpCallContext) => boolean | Promise<boolean>
  /**
   * Abort a tool call that takes longer than this, with an error result.
   * Default: no limit.
   */
  toolTimeoutMs?: number
  /**
   * Expose routes carrying these [route flags](https://kickjs.app/guide/route-flags)
   * as tools, without `@McpTool` — on a method, a controller, or a module
   * mount (`routes: () => ({ …, flags: ['mcp.tool'] })`). Takes the same
   * forms as `skipWhen`: a name, `'!name'`, a list, or a predicate.
   *
   * When the matching flag carries an object value, it is read as tool
   * options: `defineRouteFlag<Partial<McpToolOptions>>('mcp.tool')`
   * then `@Tool({ description: 'Manage webhooks' })`. `@McpTool` on the
   * method takes precedence over the flag's options.
   */
  exposeWhen?: RouteFlagTest
  /**
   * Never expose routes carrying these route flags — wins over `@McpTool`,
   * `exposeWhen` and `mode: 'auto'`. Use it to hide a whole controller or
   * module mount, including ones you don't own.
   */
  hideWhen?: RouteFlagTest
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
  /** Arguments to pass to the tool. Must match the tool's input schema. */
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
   * Replace the tool's query/body input schema. Any schema library
   * `@forinda/kickjs-schema` supports (Zod, Valibot, Yup, Standard Schema).
   * Path parameters are still added. If omitted, the input is built from
   * the route's `params`, `query` and `body` schemas.
   */
  inputSchema?: unknown
  /**
   * The shape of a successful result, from any schema library. Advertised in
   * `tools/list`; a JSON object response is then also sent as
   * `structuredContent`. Not validated at runtime.
   */
  outputSchema?: unknown
  /** Behaviour hints for clients — read-only, destructive, idempotent. */
  annotations?: McpToolAnnotations
  /** A display name. */
  title?: string
  /**
   * Scopes the caller's principal must hold. A call without them is refused
   * with `403` and `WWW-Authenticate: Bearer error="insufficient_scope"`, so
   * the client can ask the user for more access.
   */
  scopes?: string[]
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
 * Users don't construct this directly — it's derived from `@McpTool`
 * metadata plus route metadata from `@Controller`, and exposed via
 * `getTools()` for inspection and the `kick mcp --list` command.
 */
export interface McpToolDefinition {
  /** Resolved tool name (either from options.name or derived). */
  name: string
  /** Human-readable description. */
  description: string
  /**
   * JSON Schema for tool inputs: path parameters plus the route's query
   * and body fields.
   */
  inputSchema: Record<string, unknown>
  /** Optional JSON Schema for tool outputs. */
  outputSchema?: Record<string, unknown>
  /** HTTP method of the underlying route. */
  httpMethod: string
  /** Full mount path of the underlying route (after apiPrefix + version). */
  mountPath: string
  /** Examples for documentation. */
  examples?: McpToolExample[]
  annotations?: McpToolAnnotations
  title?: string
  scopes?: string[]
}

/**
 * What a custom tool's handler receives besides its arguments.
 */
export interface McpToolContext {
  /** Headers of the MCP request that carried the call (credentials, tracing). */
  headers: Headers
  /** Who is calling, when `auth.authenticate` is configured. */
  principal?: McpPrincipal
  /**
   * Scheme and host of the MCP request — build requests to your own routes
   * from it, so they keep the caller's host: `new Request(new URL('/api/v1/x', ctx.origin))`.
   */
  origin: string
  /** Aborted when the client cancels the call. */
  signal: AbortSignal
  /**
   * Run a `Request` through this app's pipeline — to call one of the app's
   * own routes with the caller's credentials. See `AdapterContext.fetch`.
   */
  fetch(request: Request): Promise<Response>
}

/**
 * A tool that is not a controller route, mounted with
 * `McpAdapter.registerProvider()`.
 *
 * The handler's return value becomes the tool result: a string is sent as
 * text, anything else as JSON text, and an object that is already an MCP
 * result (`{ content: [...] }`) is sent as is. A thrown error becomes an
 * error result with its message.
 */
export interface McpCustomTool<TArgs = any> {
  /** Unique across every tool on the server. `[A-Za-z0-9_.-]{1,128}`. */
  name: string
  /** What the tool does, for the model. */
  description: string
  /**
   * Input schema, from any library `@forinda/kickjs-schema` supports. The
   * arguments are validated against it before the handler runs; invalid
   * arguments return an error result. Omit for a tool without arguments.
   */
  inputSchema?: unknown
  /** The shape of a successful result; an object result is then also sent as `structuredContent`. */
  outputSchema?: unknown
  annotations?: McpToolAnnotations
  title?: string
  /** Scopes the caller's principal must hold — see `McpToolOptions.scopes`. */
  scopes?: string[]
  handler(args: TArgs, ctx: McpToolContext): unknown
}

/**
 * A named set of custom tools, mounted with `McpAdapter.registerProvider()`
 * at any time — before startup, or later from a plugin or module. Registering
 * a provider with the name of one already mounted replaces it.
 *
 * @example
 * ```ts
 * const reports: McpToolProvider = {
 *   name: 'reports',
 *   tools: [
 *     {
 *       name: 'monthly_report',
 *       description: 'Build the monthly revenue report',
 *       inputSchema: z.object({ month: z.string() }),
 *       handler: ({ month }, ctx) => buildReport(month, ctx.signal),
 *     },
 *   ],
 * }
 * container.resolve(MCP_ADAPTER).registerProvider(reports)
 * ```
 */
export interface McpToolProvider {
  name: string
  tools: McpCustomTool[]
}
