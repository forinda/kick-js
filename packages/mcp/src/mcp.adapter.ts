import { randomUUID } from 'node:crypto'
import {
  Logger,
  METADATA,
  defineAdapter,
  getClassMeta,
  assertFlagTest,
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
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  isInitializeRequest,
} from '@modelcontextprotocol/sdk/types.js'
import {
  buildRouteTool,
  detectSchema,
  type KickSchema,
  type RouteTool,
} from '@forinda/kickjs-schema'
import { MCP_ADAPTER } from './constants'
import { getMcpToolMeta } from './decorators'
import { McpToolError } from './errors'
import type {
  McpAdapterOptions,
  McpCallContext,
  McpCustomTool,
  McpPrincipal,
  McpRequestInfo,
  McpToolDefinition,
  McpToolOptions,
  McpToolProvider,
  McpToolSummary,
  McpTransport,
} from './types'

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

/** Node request headers as web Headers. */
function toHeaders(
  raw: Record<string, string | string[] | undefined> | Headers | undefined,
): Headers {
  if (raw instanceof Headers) return new Headers(raw)
  const headers = new Headers()
  for (const [name, value] of Object.entries(raw ?? {})) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value)
  }
  return headers
}

/** A `WWW-Authenticate: Bearer` value with the given parameters. */
function bearerChallenge(params: Record<string, string | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}="${String(v).replace(/["\\]/g, '\\$&')}"`)
  return parts.length ? `Bearer ${parts.join(', ')}` : 'Bearer'
}

/** Required scopes the principal doesn't hold. */
function missingScopes(
  required: string[] | undefined,
  principal: McpPrincipal | undefined,
): string[] {
  if (!required?.length) return []
  const granted = new Set(principal?.scopes ?? [])
  return required.filter((scope) => !granted.has(scope))
}

/** Whether the principal's audience, when it has one, names this resource. */
function audienceMatches(principal: McpPrincipal, resource: string): boolean {
  if (principal.audience === undefined) return true
  const audiences = Array.isArray(principal.audience) ? principal.audience : [principal.audience]
  const strip = (url: string) => url.replace(/\/+$/, '')
  return audiences.some((aud) => strip(aud) === strip(resource))
}

/** A plain JSON object (not an array, not null). */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The result shape every tool path returns. */
type ToolResult = {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
  structuredContent?: Record<string, unknown>
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
  dispatchTool(tool: McpToolDefinition, args: unknown, extra?: unknown): Promise<ToolResult>

  /**
   * Mount a set of custom tools that are not controller routes — at any
   * time, including after clients are connected; they are notified with
   * `tools/list_changed`. A provider with the same name is replaced. Throws
   * when a tool name is invalid or already used by a route or another
   * provider.
   */
  registerProvider(provider: McpToolProvider): void

  /** Unmount a provider's tools. Returns false when no such provider is mounted. */
  unregisterProvider(name: string): boolean
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
 *       transport: 'http',
 *     }),
 *   ],
 * })
 * ```
 */
export const McpAdapter = defineAdapter<McpAdapterOptions, McpAdapterExtensions>({
  name: 'McpAdapter',
  defaults: {
    mode: 'explicit',
    transport: 'http',
    basePath: '/_mcp',
    version: '0.0.0',
  },
  build: (options) => {
    // A mixed-polarity list fails here, where the adapter is configured,
    // not later inside startup where the error would be swallowed.
    if (options.exposeWhen) assertFlagTest(options.exposeWhen, 'McpAdapter.exposeWhen')
    if (options.hideWhen) assertFlagTest(options.hideWhen, 'McpAdapter.hideWhen')

    /** Controllers collected during the mount phase, in insertion order. */
    const mountedControllers: Array<{ controller: Constructor; mountPath: string }> = []

    /** Discovered tool definitions, built during `beforeStart`. */
    const tools: McpToolDefinition[] = []

    /** Input schema + argument-to-request mapping per tool name. */
    const routeTools = new Map<string, RouteTool>()

    /** Custom tools by provider name, with their validated schemas. */
    type ProviderEntry = {
      tool: McpCustomTool
      provider: string
      schema?: KickSchema
      inputSchema: Record<string, unknown>
      outputSchema?: Record<string, unknown>
    }
    const providers = new Map<string, ProviderEntry[]>()

    const providerToolNamed = (name: string) => {
      for (const tools of providers.values()) {
        const found = tools.find((entry) => entry.tool.name === name)
        if (found) return found
      }
      return undefined
    }

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
      {
        server: Server
        transport: WebStandardStreamableHTTPServerTransport
        /** Requests in progress, including an open notification stream. */
        active: number
        /** Closes the session after `sessionIdleTimeoutMs` with nothing in progress. */
        idleTimer?: ReturnType<typeof setTimeout>
      }
    >()
    const maxSessions = options.maxSessions ?? 1000
    const sessionIdleTimeoutMs = options.sessionIdleTimeoutMs ?? 30 * 60_000

    /** The MCP endpoint's path. */
    const endpointPath = options.path ?? `${options.basePath!}/messages`
    const metadataPath = '/.well-known/oauth-protected-resource'

    /**
     * Host, origin and resource URL of an MCP request. Forwarded headers are
     * believed only with `trustProxy`; otherwise a client could pick them.
     */
    const requestInfoFor = (
      raw: Record<string, string | string[] | undefined>,
      encrypted: boolean,
    ): McpRequestInfo => {
      const forwarded = (name: string) =>
        options.trustProxy ? firstHeader(raw[name])?.split(',')[0]?.trim() : undefined
      const host = forwarded('x-forwarded-host') ?? firstHeader(raw.host) ?? 'localhost'
      const scheme = forwarded('x-forwarded-proto') ?? (encrypted ? 'https' : 'http')
      const origin = `${scheme}://${host}`
      return { headers: toHeaders(raw), host, origin, resource: `${origin}${endpointPath}` }
    }

    /** Request info for a call that didn't come over HTTP (stdio, direct dispatch). */
    const localRequestInfo = (headers?: Headers): McpRequestInfo => ({
      headers: headers ?? new Headers(),
      host: 'localhost',
      origin: 'http://localhost',
      resource: `http://localhost${endpointPath}`,
    })

    /** The caller of a tool request, from what the HTTP handler attached. */
    const callContextOf = (extra: unknown): McpCallContext => {
      const attached = (extra as { authInfo?: AuthInfo } | undefined)?.authInfo?.extra?.call
      if (attached) return attached as McpCallContext
      const raw = (extra as { requestInfo?: { headers?: Record<string, string> } } | undefined)
        ?.requestInfo?.headers
      return raw ? requestInfoFor(raw, false) : localRequestInfo()
    }

    /** Start the idle countdown for a session that has nothing in progress. */
    const armIdleTimer = (id: string) => {
      const session = sessions.get(id)
      if (!session || session.active > 0) return
      clearTimeout(session.idleTimer)
      session.idleTimer = setTimeout(() => {
        void session.transport.close()
      }, sessionIdleTimeoutMs)
      session.idleTimer.unref?.()
    }

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
      if (routeTools.has(name) || providerToolNamed(name)) {
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
        ...(meta?.annotations ? { annotations: meta.annotations } : {}),
        ...(meta?.title ? { title: meta.title } : {}),
        ...(meta?.scopes?.length ? { scopes: meta.scopes } : {}),
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

    /** The call's abort signal, plus the tool timeout when one is set. */
    const callSignal = (extra: unknown): AbortSignal | undefined => {
      const signal = (extra as { signal?: AbortSignal } | undefined)?.signal
      if (!options.toolTimeoutMs) return signal
      const timeout = AbortSignal.timeout(options.toolTimeoutMs)
      return signal ? AbortSignal.any([signal, timeout]) : timeout
    }

    const errorResult = (
      text: string,
      structuredContent?: Record<string, unknown>,
    ): ToolResult => ({
      isError: true,
      content: [{ type: 'text' as const, text }],
      ...(structuredContent ? { structuredContent } : {}),
    })

    const timedOut = (name: string, err: unknown) =>
      options.toolTimeoutMs !== undefined &&
      err instanceof Error &&
      (err.name === 'TimeoutError' || err.name === 'AbortError') &&
      errorResult(`Tool ${name} timed out after ${options.toolTimeoutMs}ms`, {
        error: { code: 'timeout', message: `Timed out after ${options.toolTimeoutMs}ms` },
      })

    /**
     * Dispatch a tool call through the app's own pipeline — middleware,
     * validation, contributors, guards, error handling — as a request to the
     * tool's route, addressed to the MCP request's own origin so host-based
     * lookups (a tenant per host) see the caller's host. Headers in
     * `forwardHeaders` are copied from the MCP request, and the client's
     * cancellation (or `toolTimeoutMs`) aborts the call.
     */
    const dispatchTool = async (
      tool: McpToolDefinition,
      rawArgs: unknown,
      extra?: unknown,
    ): Promise<ToolResult> => {
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
        signal: callSignal(extra),
      }
      if (target.body !== undefined) {
        headers.set('content-type', 'application/json')
        init.body = JSON.stringify(target.body)
      }

      try {
        const res = appFetch
          ? await appFetch(new Request(new URL(target.url, callContextOf(extra).origin), init))
          : await fetch(`${serverBaseUrl}${target.url}`, init)
        const text = await res.text()
        const isError = res.status >= 400
        let json: unknown
        try {
          json = text ? JSON.parse(text) : undefined
        } catch {
          json = undefined
        }
        // A JSON object answer is also sent as structuredContent: for an
        // error that's the Problem Details body (machine-readable `type` and
        // `status`); for a success, when the tool declares an output schema.
        const structured =
          isJsonObject(json) && (isError || tool.outputSchema) ? { structuredContent: json } : {}
        return {
          isError,
          content: [{ type: 'text' as const, text: text || `(${res.status} ${res.statusText})` }],
          ...structured,
        }
      } catch (err) {
        const timeout = timedOut(tool.name, err)
        if (timeout) return timeout
        const message = err instanceof Error ? err.message : String(err)
        log.error(err as Error, `McpAdapter: dispatch failed for ${tool.name}`)
        return errorResult(`Tool dispatch error: ${message}`)
      }
    }

    /** Run a custom tool: validate arguments, call the handler, shape the result. */
    const callCustomTool = async (
      entry: ProviderEntry,
      args: unknown,
      extra: unknown,
    ): Promise<ToolResult | Record<string, unknown>> => {
      let input = args
      if (entry.schema) {
        const parsed = entry.schema.safeParse(args)
        if (!parsed.success) {
          return errorResult(
            JSON.stringify({ error: 'Invalid arguments', issues: parsed.issues }),
            {
              error: {
                code: 'invalid_arguments',
                message: 'Invalid arguments',
                issues: parsed.issues,
              },
            },
          )
        }
        input = parsed.data
      }

      const call = callContextOf(extra)
      const signal = callSignal(extra) ?? new AbortController().signal
      const context = {
        headers: call.headers,
        principal: call.principal,
        origin: call.origin,
        signal,
        fetch: (request: Request) => {
          if (!appFetch) throw new Error('McpAdapter: the app is not started yet')
          return appFetch(request)
        },
      }

      try {
        const run = Promise.resolve(entry.tool.handler(input, context))
        // A handler that ignores the signal still ends at the timeout.
        const result = options.toolTimeoutMs
          ? await Promise.race([
              run,
              new Promise<never>((_, reject) =>
                signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
              ),
            ])
          : await run
        if (isJsonObject(result) && Array.isArray(result.content)) return result
        const text = typeof result === 'string' ? result : JSON.stringify(result ?? null)
        return {
          content: [{ type: 'text' as const, text }],
          ...(entry.outputSchema && isJsonObject(result) ? { structuredContent: result } : {}),
        }
      } catch (err) {
        if (err instanceof McpToolError) {
          return errorResult(err.message, {
            error: { code: err.code, message: err.message, ...err.data },
          })
        }
        const timeout = timedOut(entry.tool.name, err)
        if (timeout) return timeout
        log.error(err as Error, `McpAdapter: custom tool ${entry.tool.name} failed`)
        return errorResult(err instanceof Error ? err.message : String(err))
      }
    }

    /** Every tool, route and custom, as filters and `tools/list` see it. */
    const allTools = () => [
      ...tools.map((def) => ({
        summary: {
          name: def.name,
          description: def.description,
          kind: 'route' as const,
          scopes: def.scopes,
          annotations: def.annotations,
          route: { method: def.httpMethod, path: def.mountPath },
        } satisfies McpToolSummary,
        listed: {
          name: def.name,
          description: def.description,
          inputSchema: def.inputSchema,
          ...(def.title ? { title: def.title } : {}),
          ...(def.annotations ? { annotations: def.annotations } : {}),
          ...(def.outputSchema ? { outputSchema: def.outputSchema } : {}),
        },
        route: def,
      })),
      ...[...providers.values()].flat().map((entry) => ({
        summary: {
          name: entry.tool.name,
          description: entry.tool.description,
          kind: 'custom' as const,
          scopes: entry.tool.scopes,
          annotations: entry.tool.annotations,
          provider: entry.provider,
        } satisfies McpToolSummary,
        listed: {
          name: entry.tool.name,
          description: entry.tool.description,
          inputSchema: entry.inputSchema,
          ...(entry.tool.title ? { title: entry.tool.title } : {}),
          ...(entry.tool.annotations ? { annotations: entry.tool.annotations } : {}),
          ...(entry.outputSchema ? { outputSchema: entry.outputSchema } : {}),
        },
        custom: entry,
      })),
    ]

    /** Whether `toolFilter` lets this caller see the tool. A throw hides it. */
    const visible = async (summary: McpToolSummary, call: McpCallContext): Promise<boolean> => {
      if (!options.toolFilter) return true
      try {
        return Boolean(await options.toolFilter(summary, call))
      } catch (err) {
        log.error(err as Error, `McpAdapter: toolFilter threw for ${summary.name}; hiding it`)
        return false
      }
    }

    /** Tell every connected client the tool list changed. */
    const notifyToolsChanged = () => {
      const servers = [
        ...[...sessions.values()].map((s) => s.server),
        ...(mcpServer ? [mcpServer] : []),
      ]
      for (const server of servers) {
        server.sendToolListChanged().catch(() => {
          // A client that disconnected mid-notification is cleaned up by its transport.
        })
      }
    }

    const registerProvider = (provider: McpToolProvider): void => {
      const entries = provider.tools.map((tool) => {
        if (!MCP_TOOL_NAME.test(tool.name)) {
          throw new Error(
            `McpAdapter: tool name "${tool.name}" (provider ${provider.name}) must match [A-Za-z0-9_.-]{1,128}`,
          )
        }
        const owner = routeTools.has(tool.name)
          ? 'a route'
          : [...providers.entries()].find(
              ([name, list]) =>
                name !== provider.name && list.some((e) => e.tool.name === tool.name),
            )?.[0]
        if (owner) {
          throw new Error(
            `McpAdapter: tool "${tool.name}" (provider ${provider.name}) is already defined by ${owner}`,
          )
        }
        const schema = tool.inputSchema === undefined ? undefined : detectSchema(tool.inputSchema)
        const inputSchema = schema?.toJsonSchema() ?? { type: 'object', properties: {} }
        const outputSchema =
          tool.outputSchema === undefined
            ? undefined
            : detectSchema(tool.outputSchema).toJsonSchema()
        return { tool, provider: provider.name, schema, inputSchema, outputSchema }
      })
      const names = entries.map((e) => e.tool.name)
      if (new Set(names).size !== names.length) {
        throw new Error(`McpAdapter: provider ${provider.name} defines the same tool name twice`)
      }
      providers.set(provider.name, entries)
      notifyToolsChanged()
    }

    const unregisterProvider = (name: string): boolean => {
      const removed = providers.delete(name)
      if (removed) notifyToolsChanged()
      return removed
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
        { capabilities: { tools: { listChanged: true } } },
      )

      server.setRequestHandler(ListToolsRequestSchema, async (_request, extra) => {
        const call = callContextOf(extra)
        const listed: Array<Record<string, unknown>> = []
        for (const tool of allTools()) {
          if (await visible(tool.summary, call)) listed.push(tool.listed)
        }
        return { tools: listed as never }
      })

      server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
        const args = request.params.arguments ?? {}
        const tool = allTools().find((t) => t.summary.name === request.params.name)
        // A tool the caller can't see answers like one that doesn't exist.
        if (!tool || !(await visible(tool.summary, callContextOf(extra)))) {
          throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${request.params.name}`)
        }
        return (
          'route' in tool
            ? await dispatchTool(tool.route, args, extra)
            : await callCustomTool(tool.custom, args, extra)
        ) as never
      })

      return server
    }

    type Rejection = { status: number; message: string; headers?: Record<string, string> }

    /** The 401 / 403 challenge, with resource metadata and scopes when known. */
    const challenge = (info: McpRequestInfo, params: Record<string, string | undefined> = {}) => {
      const configured = options.auth?.resourceMetadataUrl
      const metadataUrl =
        typeof configured === 'function'
          ? configured(info)
          : (configured ??
            (options.protectedResource
              ? `${info.origin}${metadataPath}${endpointPath}`
              : undefined))
      return bearerChallenge({ resource_metadata: metadataUrl, ...params })
    }

    const hostAllowed = (host: string): boolean => {
      const allowed = options.allowedHosts
      if (!allowed) return true
      const bare = host.replace(/:\d+$/, '')
      return typeof allowed === 'function'
        ? allowed(host)
        : allowed.includes(host) || allowed.includes(bare)
    }

    /**
     * Host, origin and auth checks for one HTTP request. Returns the
     * rejection to send, or who is calling (when `authenticate` says).
     *
     * Origin: browsers send it, MCP clients (Claude Code, Cursor, the SDK) do
     * not. A request that carries one must match `allowedOrigins` — the MCP
     * spec requires this to stop DNS-rebinding attacks from web pages.
     */
    const checkAccess = async (
      headers: Record<string, string | string[] | undefined>,
      info: McpRequestInfo,
    ): Promise<{ denied: Rejection } | { principal?: McpPrincipal; credential: string }> => {
      if (!hostAllowed(info.host)) {
        return { denied: { status: 403, message: `Forbidden: host ${info.host} is not allowed` } }
      }
      const origin = firstHeader(headers.origin)
      const allowedOrigins = options.allowedOrigins ?? []
      if (origin && !allowedOrigins.includes('*') && !allowedOrigins.includes(origin)) {
        return { denied: { status: 403, message: `Forbidden: origin ${origin} is not allowed` } }
      }

      const auth = options.auth
      if (!auth) return { credential: '' }
      const authorization = firstHeader(headers.authorization) ?? ''
      const credential =
        auth.type === 'bearer' ? (/^Bearer\s+(.+)$/i.exec(authorization)?.[1] ?? '') : authorization
      const unauthorized: { denied: Rejection } = {
        denied: {
          status: 401,
          message: 'Unauthorized',
          ...(auth.type === 'bearer'
            ? {
                headers: { 'www-authenticate': challenge(info, { scope: auth.scopes?.join(' ') }) },
              }
            : {}),
        },
      }
      if (auth.type === 'bearer' && credential === '') return unauthorized
      try {
        if (auth.authenticate) {
          const principal = await auth.authenticate(credential, info)
          if (!principal) return unauthorized
          // A token minted for another resource (another tenant's server) is refused.
          if (!audienceMatches(principal, info.resource)) return unauthorized
          return { principal, credential }
        }
        if (await auth.validate(credential)) return { credential }
      } catch (err) {
        log.error(err as Error, 'McpAdapter: auth threw; rejecting the request')
      }
      return unauthorized
    }

    /**
     * The scopes a `tools/call` in this body needs and the principal lacks —
     * refused before the call runs, with a challenge naming them.
     */
    const lackingScopes = async (body: unknown, call: McpCallContext): Promise<string[]> => {
      const messages = Array.isArray(body) ? body : [body]
      const lacking = new Set<string>()
      for (const message of messages) {
        if (!isJsonObject(message) || message.method !== 'tools/call') continue
        const name = (message.params as { name?: unknown } | undefined)?.name
        const tool = allTools().find((t) => t.summary.name === name)
        // A hidden tool must answer like an unknown one, so it's left to the
        // call handler rather than revealing its scopes here.
        if (!tool || !(await visible(tool.summary, call))) continue
        for (const scope of missingScopes(tool.summary.scopes, call.principal)) lacking.add(scope)
      }
      return [...lacking]
    }

    /** Mount the Streamable HTTP endpoint via the engine-agnostic HTTP facade. */
    const mountHttpRoutes = (http: AdapterHttp): void => {
      const path = endpointPath

      // The SDK's web-standard transport takes a Request and returns a
      // Response. Building the Request from `ctx.req` (method, url, headers —
      // present on every runtime) and sending the Response with
      // `ctx.sendResponse` keeps the endpoint independent of the HTTP engine.
      const handleRequest = async (ctx: RequestContext): Promise<void> => {
        const req = ctx.req as {
          method?: string
          url?: string
          headers: Record<string, string | string[] | undefined>
          socket?: { encrypted?: boolean }
        }
        try {
          const info = requestInfoFor(req.headers, Boolean(req.socket?.encrypted))
          const access = await checkAccess(req.headers, info)
          if ('denied' in access) {
            await sendJsonRpcError(
              ctx,
              access.denied.status,
              access.denied.message,
              access.denied.headers,
            )
            return
          }

          const webRequest = new Request(new URL(req.url ?? path, 'http://localhost'), {
            method: req.method ?? 'POST',
            headers: toHeaders(req.headers),
            signal: ctx.signal,
          })
          const parsedBody = webRequest.method === 'POST' ? ctx.body : undefined

          // Who is calling travels with the request to the tool handlers.
          const call: McpCallContext = { ...info, principal: access.principal }

          // A tool that needs scopes the caller lacks: 403 with a challenge
          // naming them, so the client can ask for more access (step-up).
          const lacking = await lackingScopes(parsedBody, call)
          if (lacking.length > 0) {
            await sendJsonRpcError(ctx, 403, 'Forbidden: insufficient scope', {
              'www-authenticate': challenge(info, {
                error: 'insufficient_scope',
                scope: lacking.join(' '),
              }),
            })
            return
          }

          const authInfo: AuthInfo = {
            token: access.credential,
            clientId: access.principal?.clientId ?? '',
            scopes: access.principal?.scopes ?? [],
            extra: { call },
          }

          if (options.stateless) {
            if (webRequest.method !== 'POST') {
              await sendJsonRpcError(
                ctx,
                405,
                'Method not allowed: this MCP endpoint is stateless',
                {
                  allow: 'POST',
                },
              )
              return
            }
            // A fresh server for each request: nothing outlives it, so any
            // instance can answer any request.
            const server = buildMcpServer()
            const statelessTransport = new WebStandardStreamableHTTPServerTransport({
              sessionIdGenerator: undefined,
              enableJsonResponse: true,
            })
            try {
              await server.connect(statelessTransport)
              await ctx.sendResponse(
                await statelessTransport.handleRequest(webRequest, { parsedBody, authInfo }),
              )
            } finally {
              await server.close().catch(() => {})
            }
            return
          }

          const sessionId = firstHeader(req.headers['mcp-session-id'])
          if (sessionId) {
            const session = sessions.get(sessionId)
            if (!session) {
              await sendJsonRpcError(ctx, 404, 'Session not found')
              return
            }
            session.active++
            clearTimeout(session.idleTimer)
            try {
              await ctx.sendResponse(
                await session.transport.handleRequest(webRequest, { parsedBody, authInfo }),
              )
            } finally {
              session.active--
              armIdleTimer(sessionId)
            }
            return
          }

          if (webRequest.method !== 'POST' || !isInitializeRequest(parsedBody)) {
            await sendJsonRpcError(ctx, 400, 'Bad Request: no valid session ID provided')
            return
          }

          // Each session holds an MCP server and transport, and initialize needs
          // no session — cap them so clients (authenticated or not) can't
          // exhaust memory, and close abandoned ones after an idle timeout.
          if (sessions.size >= maxSessions) {
            await sendJsonRpcError(ctx, 503, 'Too many MCP sessions; try again later')
            return
          }
          const server = buildMcpServer()
          const sessionTransport = new WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id) => {
              sessions.set(id, { server, transport: sessionTransport, active: 0 })
            },
          })
          // Set before connect(): the SDK wraps an existing onclose, but a
          // handler assigned afterwards would replace its cleanup.
          // oxlint-disable-next-line unicorn/prefer-add-event-listener -- MCP SDK transports expose only an `onclose` property
          sessionTransport.onclose = () => {
            const id = sessionTransport.sessionId
            if (!id) return
            clearTimeout(sessions.get(id)?.idleTimer)
            sessions.delete(id)
          }
          await server.connect(sessionTransport)
          await ctx.sendResponse(
            await sessionTransport.handleRequest(webRequest, { parsedBody, authInfo }),
          )
          if (sessionTransport.sessionId) armIdleTimer(sessionTransport.sessionId)
        } catch (err) {
          log.error(err as Error, `McpAdapter: error handling ${req.method} ${path}`)
          if (!ctx.res.headersSent) await sendJsonRpcError(ctx, 500, 'MCP transport error')
        }
      }

      // Mount all three verbs in a single table so they share one router —
      // this is what lets the engine auto-answer the OPTIONS preflight with the
      // correct Allow header (separate `route()` calls would each get their own
      // router and the preflight wouldn't aggregate).
      const makeEntry = (
        method: RouteMethod,
        entryPath: string,
        handler = handleRequest,
      ): RouteEntry => ({
        method,
        path: entryPath,
        middlewares: [],
        contributorRunner: null,
        handler,
        meta: {},
      })
      const entries = [makeEntry('POST', path), makeEntry('GET', path), makeEntry('DELETE', path)]

      // OAuth protected-resource metadata (RFC 9728), at the well-known path
      // and at it plus the endpoint path, per host.
      const protectedResource = options.protectedResource
      if (protectedResource) {
        const serveMetadata = async (ctx: RequestContext): Promise<void> => {
          const raw = ctx.req.headers as Record<string, string | string[] | undefined>
          const info = requestInfoFor(
            raw,
            Boolean((ctx.req as { socket?: { encrypted?: boolean } }).socket?.encrypted),
          )
          const servers = protectedResource.authorizationServers
          await ctx.sendResponse(
            new Response(
              JSON.stringify({
                resource: protectedResource.resource?.(info) ?? info.resource,
                authorization_servers: typeof servers === 'function' ? servers(info) : servers,
                ...(protectedResource.scopesSupported
                  ? { scopes_supported: protectedResource.scopesSupported }
                  : {}),
                bearer_methods_supported: ['header'],
              }),
              { headers: { 'content-type': 'application/json' } },
            ),
          )
        }
        entries.push(
          makeEntry('GET', metadataPath, serveMetadata),
          makeEntry('GET', `${metadataPath}${path}`, serveMetadata),
        )
      }
      http.mount('/', entries)
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

    const publicSurface: McpAdapterExtensions = {
      getTools: () => tools,
      dispatchTool,
      registerProvider,
      unregisterProvider,
    }

    return {
      ...publicSurface,

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
        // Optional call: hooks driven by hand in tests may pass a partial container.
        ctx.container?.registerInstance?.(MCP_ADAPTER, publicSurface)
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
            "McpAdapter: transport 'sse' is deprecated and behaves like 'http' (Streamable HTTP). Set transport: 'http'.",
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
          `McpAdapter ready — ${tools.length} tool(s) registered, listening at ${endpointPath}${options.stateless ? ' (stateless)' : ''}`,
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
        for (const session of open) clearTimeout(session.idleTimer)
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
