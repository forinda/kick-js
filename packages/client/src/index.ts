// @forinda/kickjs-client — typed fetch client for KickJS APIs.
//
// Consumes the flat `KickRoutes.Api` map that `kick typegen` emits
// (response-inference-design.md R3): keys are `'METHOD /path'`, values are
// the route shapes (`params` / `body` / `query` / `response`). The client is
// a ~150-line fetch wrapper — every type below exists so the CALL SITE
// infers exactly:
//
// ```ts
// const api = createClient<KickRoutes.Api>({ baseUrl: 'https://x/api/v1' })
// const task = await api.post('/tasks/:id', { params: { id }, body })
// //    ^ the handler's actual response type
// ```
//
// Runtime-neutral: fetch/URL/Headers only — browsers, node ≥ 20, Bun, Deno,
// and edge workers (pairs with `@forinda/kickjs/web` on the server side).

/**
 * The per-route shape `kick typegen` emits into `KickRoutes.Api`.
 * Deliberately re-declares (NOT imports) @forinda/kickjs's `RouteShape`:
 * frontends installing this client must never need the server package.
 * Keep the field list in sync with `RouteShape` in kickjs http/context.ts.
 */
export interface RouteShapeLike {
  params: unknown
  body: unknown
  query: unknown
  response: unknown
}

// `object`, not `Record<string, RouteShapeLike>`: the generated
// `KickRoutes.Api` is an INTERFACE, which has no string index signature and
// would fail a Record constraint. Key/value conformance is guaranteed by the
// generator; PathsFor/ShapeOf only rely on `keyof Api`.
type ApiMap = object

/** HTTP verbs the route decorators produce. */
export type ClientMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

/** Paths in the map registered under a given verb. */
type PathsFor<Api extends ApiMap, M extends ClientMethod> = {
  [K in keyof Api]: K extends `${M} ${infer P}` ? P : never
}[keyof Api]

// Fallback is `never` ON PURPOSE: P is already constrained to PathsFor, so a
// failed key lookup means the map and the client's key math drifted — that
// must fail loudly at the call site, not silently degrade to unknown.
type ShapeOf<
  Api extends ApiMap,
  M extends ClientMethod,
  P extends string,
> = `${M} ${P}` extends keyof Api
  ? Api[`${M} ${P}`] extends RouteShapeLike
    ? Api[`${M} ${P}`]
    : never
  : never

// ── SSE typing ────────────────────────────────────────────────────────
// Server handlers that `return ctx.sse<T>()` put an `SseHandler<T>` into the
// map's response slot; its phantom `__sse` property carries T structurally,
// so the client detects SSE routes without importing server types. The
// optional-property check must be non-vacuous — `'__sse' extends keyof S`,
// NOT `S extends { __sse?: … }` (every object vacuously extends the latter).
type SsePayloadOf<S> = S extends object
  ? '__sse' extends keyof S
    ? NonNullable<S['__sse']>
    : never
  : never

/** GET paths whose response is an SSE stream (`return ctx.sse<T>()`). */
type StreamPathsFor<Api extends ApiMap> = {
  [K in keyof Api]: K extends `GET ${infer P}`
    ? Api[K] extends RouteShapeLike
      ? [SsePayloadOf<Api[K]['response']>] extends [never]
        ? never
        : P
      : never
    : never
}[keyof Api]

// Options argument is OPTIONAL only when the shape requires nothing
// (no concrete params, no required body) — otherwise omitting it must be
// a compile error, not a runtime missing-param throw.
type ArgsFor<S extends RouteShapeLike, M extends ClientMethod> =
  Record<string, never> extends RequestOptions<S, M>
    ? [options?: RequestOptions<S, M>]
    : [options: RequestOptions<S, M>]

/** One parsed server-sent event. */
export interface SseEvent<T = unknown> {
  /** JSON-parsed `data:` payload (raw string when not valid JSON). */
  data: T
  /** The `event:` name, when the server sent one. */
  event?: string
  /** The `id:` field, when the server sent one. */
  id?: string
}

/** Typed async-iterable SSE connection — `for await`, then `close()`. */
export interface SseStream<T = unknown> extends AsyncIterable<SseEvent<T>> {
  /** Abort the underlying request and end iteration. */
  close(): void
}

// Paramless routes emit `params: {}` and unschema'd bodies emit
// `body: unknown` — both become OPTIONAL fields; a concrete shape is
// required so forgetting `params` on `/users/:id` is a type error.
type ParamsField<T> = unknown extends T
  ? { params?: Record<string, string | number> }
  : Record<string, never> extends T
    ? { params?: T }
    : { params: T }

// GET requests must not carry a body — `new Request(url, { method: 'GET',
// body })` throws at runtime, so the type forbids it up front.
type BodyField<T, M extends ClientMethod> = M extends 'GET'
  ? { body?: never }
  : unknown extends T
    ? { body?: unknown }
    : { body: T }

/** Loose fallback for routes without a statically-known query shape. */
type LooseQuery = Record<string, string | number | boolean | Array<string | number>>

// Routes with a typegen-known query shape (Zod schema or the
// @ApiQueryParams-derived filter/sort/q/page/limit object) constrain
// `query` — sort fields autocomplete as '-createdAt' | 'createdAt' | …
type QueryField<T> = unknown extends T ? { query?: LooseQuery } : { query?: T }

export type RequestOptions<S extends RouteShapeLike, M extends ClientMethod = ClientMethod> = {
  /** Extra headers merged over the client-level ones. */
  headers?: Record<string, string>
  /** AbortSignal for cancellation. */
  signal?: AbortSignal
} & ParamsField<S['params']> &
  BodyField<S['body'], M> &
  QueryField<S['query']>

export interface ClientOptions {
  /**
   * Base URL INCLUDING the mount prefix + version the server adds at
   * bootstrap (default `/api/v1`) — `KickRoutes.Api` keys are module-mount
   * relative: `'GET /users/:id'` + baseUrl `https://x/api/v1`.
   */
  baseUrl: string
  /** Static headers, or a factory invoked per request (auth tokens). */
  headers?:
    | Record<string, string>
    | (() => Record<string, string> | Promise<Record<string, string>>)
  /**
   * Custom fetch — inject a platform fetch, a mock, or a KickJS web app's
   * own handler for network-free tests: `{ fetch: app.fetch }`.
   */
  fetch?: (request: Request) => Promise<Response>
}

/** Non-2xx responses throw this — carries the parsed body (RFC 9457 problem details when the server used `ctx.problem`). */
export class KickClientError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    readonly response: Response,
  ) {
    super(
      typeof body === 'object' && body !== null && 'detail' in body
        ? String((body as { detail: unknown }).detail)
        : typeof body === 'object' && body !== null && 'error' in body
          ? String((body as { error: unknown }).error)
          : `Request failed with status ${status}`,
    )
    this.name = 'KickClientError'
  }
}

export interface KickClient<Api extends ApiMap> {
  get<P extends PathsFor<Api, 'GET'> & string>(
    path: P,
    ...args: ArgsFor<ShapeOf<Api, 'GET', P>, 'GET'>
  ): Promise<ShapeOf<Api, 'GET', P>['response']>
  /**
   * Open a typed SSE connection to a route whose handler
   * `return ctx.sse<T>()` — events arrive as `SseEvent<T>`:
   *
   * ```ts
   * const stream = await api.stream('/events')
   * for await (const ev of stream) console.log(ev.data) // ev.data: T
   * ```
   */
  stream<P extends StreamPathsFor<Api> & string>(
    path: P,
    ...args: ArgsFor<ShapeOf<Api, 'GET', P>, 'GET'>
  ): Promise<SseStream<SsePayloadOf<ShapeOf<Api, 'GET', P>['response']>>>
  post<P extends PathsFor<Api, 'POST'> & string>(
    path: P,
    ...args: ArgsFor<ShapeOf<Api, 'POST', P>, 'POST'>
  ): Promise<ShapeOf<Api, 'POST', P>['response']>
  put<P extends PathsFor<Api, 'PUT'> & string>(
    path: P,
    ...args: ArgsFor<ShapeOf<Api, 'PUT', P>, 'PUT'>
  ): Promise<ShapeOf<Api, 'PUT', P>['response']>
  delete<P extends PathsFor<Api, 'DELETE'> & string>(
    path: P,
    ...args: ArgsFor<ShapeOf<Api, 'DELETE', P>, 'DELETE'>
  ): Promise<ShapeOf<Api, 'DELETE', P>['response']>
  patch<P extends PathsFor<Api, 'PATCH'> & string>(
    path: P,
    ...args: ArgsFor<ShapeOf<Api, 'PATCH', P>, 'PATCH'>
  ): Promise<ShapeOf<Api, 'PATCH', P>['response']>
}

interface AnyRequestOptions {
  headers?: Record<string, string>
  signal?: AbortSignal
  query?: Record<string, unknown>
  params?: Record<string, string | number>
  body?: unknown
}

/** Substitute `:param` segments; throw on any left unfilled. */
function fillPath(path: string, params?: Record<string, string | number>): string {
  const filled = path.replace(/:([A-Za-z0-9_]+)/g, (_, name: string) => {
    const value = params?.[name]
    if (value === undefined) {
      throw new Error(`@forinda/kickjs-client: missing path param ':${name}' for '${path}'`)
    }
    return encodeURIComponent(String(value))
  })
  return filled
}

/** Parse one SSE block (lines until a blank line) into an event. */
function parseSseBlock(block: string): SseEvent | null {
  let event: string | undefined
  let id: string | undefined
  const dataLines: string[] = []
  for (const line of block.split('\n')) {
    if (line.startsWith(':')) continue // comment / keep-alive
    if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
    else if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('id:')) id = line.slice(3).trim()
  }
  if (dataLines.length === 0) return null
  const raw = dataLines.join('\n')
  let data: unknown = raw
  try {
    data = JSON.parse(raw)
  } catch {
    // Non-JSON payloads pass through as the raw string.
  }
  return { data, ...(event ? { event } : {}), ...(id ? { id } : {}) }
}

function buildQuery(query?: Record<string, unknown>): string {
  if (!query) return ''
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) for (const v of value) qs.append(key, String(v))
    else qs.append(key, String(value))
  }
  const s = qs.toString()
  return s ? `?${s}` : ''
}

/**
 * Create a typed client over a `KickRoutes.Api`-shaped map.
 * Generic-only consumption — no runtime dependency on the generated file.
 */
export function createClient<Api extends ApiMap>(options: ClientOptions): KickClient<Api> {
  const baseUrl = options.baseUrl.replace(/\/$/, '')
  const doFetch = options.fetch ?? ((req: Request) => fetch(req))

  async function buildRequest(
    method: ClientMethod,
    path: string,
    opts: AnyRequestOptions,
  ): Promise<Request> {
    const clientHeaders =
      typeof options.headers === 'function' ? await options.headers() : (options.headers ?? {})
    const headers = new Headers({ ...clientHeaders, ...opts.headers })
    // Defensive: fetch's Request constructor throws on GET-with-body; the
    // types already forbid it, but casts can smuggle one through.
    const hasBody = method !== 'GET' && opts.body !== undefined
    if (hasBody && !headers.has('content-type')) {
      headers.set('content-type', 'application/json')
    }

    const url = `${baseUrl}${fillPath(path, opts.params)}${buildQuery(opts.query)}`
    return new Request(url, {
      method,
      headers,
      body: hasBody ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    })
  }

  async function run(method: ClientMethod, path: string, opts: AnyRequestOptions = {}) {
    const request = await buildRequest(method, path, opts)

    const response = await doFetch(request)
    const contentType = response.headers.get('content-type') ?? ''
    const body =
      response.status === 204
        ? undefined
        : contentType.includes('json')
          ? await response.json().catch(() => undefined)
          : await response.text()

    if (!response.ok) throw new KickClientError(response.status, body, response)
    return body
  }

  async function openStream(path: string, opts: AnyRequestOptions = {}): Promise<SseStream> {
    // Own controller so close() works even without a caller-provided signal;
    // chain the caller's signal into it when present.
    const controller = new AbortController()
    opts.signal?.addEventListener('abort', () => controller.abort(), { once: true })
    const request = await buildRequest('GET', path, {
      ...opts,
      signal: controller.signal,
      headers: { accept: 'text/event-stream', ...opts.headers },
    })

    const response = await doFetch(request)
    if (!response.ok || !response.body) {
      const contentType = response.headers.get('content-type') ?? ''
      const body = contentType.includes('json')
        ? await response.json().catch(() => undefined)
        : await response.text().catch(() => undefined)
      throw new KickClientError(response.status, body, response)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()

    async function* events(): AsyncGenerator<SseEvent> {
      let buffer = ''
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          // Events are separated by a blank line; keep the trailing partial.
          const blocks = buffer.split(/\n\n/)
          buffer = blocks.pop() ?? ''
          for (const block of blocks) {
            const ev = parseSseBlock(block)
            if (ev) yield ev
          }
        }
      } finally {
        controller.abort()
        reader.releaseLock()
      }
    }

    return {
      [Symbol.asyncIterator]: events,
      close: () => controller.abort(),
    }
  }

  return {
    get: (path: string, opts?: unknown) => run('GET', path, opts as AnyRequestOptions),
    stream: (path: string, opts?: unknown) =>
      openStream(path, (opts ?? {}) as AnyRequestOptions) as never,
    post: (path: string, opts?: unknown) => run('POST', path, opts as AnyRequestOptions),
    put: (path: string, opts?: unknown) => run('PUT', path, opts as AnyRequestOptions),
    delete: (path: string, opts?: unknown) => run('DELETE', path, opts as AnyRequestOptions),
    patch: (path: string, opts?: unknown) => run('PATCH', path, opts as AnyRequestOptions),
  } as unknown as KickClient<Api>
}

/** Anything with a web-standard fetch — a `createWebApp()` result, a Worker, a mock. */
export interface FetchLike {
  fetch(request: Request): Promise<Response>
}

/**
 * Typed client over an in-process app — network-free full-stack tests:
 *
 * ```ts
 * const app = createWebApp({ h3, modules })
 * const api = createTestClient<KickRoutes.Api>(app)
 * expect(await api.get('/tasks/:id', { params: { id: '1' } })).toEqual(...)
 * ```
 *
 * `baseUrl` defaults to `http://test/api/v1` (the bootstrap default prefix);
 * override it when the server uses a custom `apiPrefix`/version.
 */
export function createTestClient<Api extends ApiMap>(
  app: FetchLike,
  options: Omit<ClientOptions, 'fetch' | 'baseUrl'> & { baseUrl?: string } = {},
): KickClient<Api> {
  return createClient<Api>({
    ...options,
    // AFTER the spread — an explicit `baseUrl: undefined` key in options
    // must not clobber the default (spread copies undefined-valued keys).
    baseUrl: options.baseUrl ?? 'http://test/api/v1',
    fetch: (request) => app.fetch(request),
  })
}

// ── RPC sugar ─────────────────────────────────────────────────────────
// tRPC-style call shape over the SAME path-keyed map — no new inference,
// no Proxy magic. `kick typegen` emits the runtime manifest (`kickRpc` in
// kick__routes.ts): controller.method → 'VERB /mounted/path'; the types
// below re-derive everything from KickApi via ShapeOf/ArgsFor.

/** Shape of the generated `kickRpc` manifest. */
export type RpcManifest = Record<string, Record<string, string>>

type RpcMethod<Api extends ApiMap, K> = K extends `${infer V} ${infer P}`
  ? V extends ClientMethod
    ? [SsePayloadOf<ShapeOf<Api, V, P>['response']>] extends [never]
      ? (...args: ArgsFor<ShapeOf<Api, V, P>, V>) => Promise<ShapeOf<Api, V, P>['response']>
      : never // SSE routes stay explicit — use api.stream(path)
    : never
  : never

/** The typed RPC surface derived from a manifest + the Api map. */
export type KickRpc<Api extends ApiMap, M extends RpcManifest> = {
  [C in keyof M]: { [F in keyof M[C]]: RpcMethod<Api, M[C][F]> }
}

/**
 * tRPC-style sugar over a typed client:
 *
 * ```ts
 * import { kickRpc } from './.kickjs/types/kick__routes'
 *
 * const rpc = createRpc(api, kickRpc)
 * const task = await rpc.tasks.get({ params: { id: '42' } })
 * const made = await rpc.tasks.create({ body: { title: 'Ship' } })
 * ```
 *
 * A plain nested object built eagerly from the manifest — every call
 * delegates to the corresponding `api.<verb>()` with the manifest's path,
 * so behavior (headers, errors, query serialization) is identical to the
 * path-keyed surface. SSE routes are typed `never` here — open those with
 * `api.stream(path)`.
 */
export function createRpc<Api extends ApiMap, const M extends RpcManifest>(
  api: KickClient<Api>,
  manifest: M,
): KickRpc<Api, M> {
  const rpc: Record<string, Record<string, unknown>> = {}
  for (const [controller, methods] of Object.entries(manifest)) {
    const ns: Record<string, unknown> = {}
    for (const [fn, key] of Object.entries(methods)) {
      const space = key.indexOf(' ')
      const verb = key.slice(0, space).toLowerCase() as Lowercase<ClientMethod>
      const path = key.slice(space + 1)
      ns[fn] = (opts?: unknown) =>
        (api[verb] as (p: string, o?: unknown) => Promise<unknown>)(path, opts)
    }
    rpc[controller] = ns
  }
  return rpc as KickRpc<Api, M>
}
