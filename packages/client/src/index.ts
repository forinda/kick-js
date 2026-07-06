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

/** The per-route shape `kick typegen` emits into `KickRoutes.Api`. */
export interface RouteShapeLike {
  params: unknown
  body: unknown
  query: unknown
  response: unknown
}

type ApiMap = Record<string, RouteShapeLike>

/** HTTP verbs the route decorators produce. */
export type ClientMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

/** Paths in the map registered under a given verb. */
type PathsFor<Api extends ApiMap, M extends ClientMethod> = {
  [K in keyof Api]: K extends `${M} ${infer P}` ? P : never
}[keyof Api]

type ShapeOf<
  Api extends ApiMap,
  M extends ClientMethod,
  P extends string,
> = `${M} ${P}` extends keyof Api ? Api[`${M} ${P}`] : RouteShapeLike

// Paramless routes emit `params: {}` and unschema'd bodies emit
// `body: unknown` — both become OPTIONAL fields; a concrete shape is
// required so forgetting `params` on `/users/:id` is a type error.
type ParamsField<T> = unknown extends T
  ? { params?: Record<string, string | number> }
  : Record<string, never> extends T
    ? { params?: T }
    : { params: T }

type BodyField<T> = unknown extends T ? { body?: unknown } : { body: T }

/** Loose fallback for routes without a statically-known query shape. */
type LooseQuery = Record<string, string | number | boolean | Array<string | number>>

// Routes with a typegen-known query shape (Zod schema or the
// @ApiQueryParams-derived filter/sort/q/page/limit object) constrain
// `query` — sort fields autocomplete as '-createdAt' | 'createdAt' | …
type QueryField<T> = unknown extends T ? { query?: LooseQuery } : { query?: T }

export type RequestOptions<S extends RouteShapeLike> = {
  /** Extra headers merged over the client-level ones. */
  headers?: Record<string, string>
  /** AbortSignal for cancellation. */
  signal?: AbortSignal
} & ParamsField<S['params']> &
  BodyField<S['body']> &
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
    options?: RequestOptions<ShapeOf<Api, 'GET', P>>,
  ): Promise<ShapeOf<Api, 'GET', P>['response']>
  post<P extends PathsFor<Api, 'POST'> & string>(
    path: P,
    options?: RequestOptions<ShapeOf<Api, 'POST', P>>,
  ): Promise<ShapeOf<Api, 'POST', P>['response']>
  put<P extends PathsFor<Api, 'PUT'> & string>(
    path: P,
    options?: RequestOptions<ShapeOf<Api, 'PUT', P>>,
  ): Promise<ShapeOf<Api, 'PUT', P>['response']>
  delete<P extends PathsFor<Api, 'DELETE'> & string>(
    path: P,
    options?: RequestOptions<ShapeOf<Api, 'DELETE', P>>,
  ): Promise<ShapeOf<Api, 'DELETE', P>['response']>
  patch<P extends PathsFor<Api, 'PATCH'> & string>(
    path: P,
    options?: RequestOptions<ShapeOf<Api, 'PATCH', P>>,
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

  async function run(method: ClientMethod, path: string, opts: AnyRequestOptions = {}) {
    const clientHeaders =
      typeof options.headers === 'function' ? await options.headers() : (options.headers ?? {})
    const headers = new Headers({ ...clientHeaders, ...opts.headers })
    const hasBody = opts.body !== undefined
    if (hasBody && !headers.has('content-type')) {
      headers.set('content-type', 'application/json')
    }

    const url = `${baseUrl}${fillPath(path, opts.params)}${buildQuery(opts.query)}`
    const request = new Request(url, {
      method,
      headers,
      body: hasBody ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    })

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

  return {
    get: (path, opts) => run('GET', path, opts as AnyRequestOptions),
    post: (path, opts) => run('POST', path, opts as AnyRequestOptions),
    put: (path, opts) => run('PUT', path, opts as AnyRequestOptions),
    delete: (path, opts) => run('DELETE', path, opts as AnyRequestOptions),
    patch: (path, opts) => run('PATCH', path, opts as AnyRequestOptions),
  } as KickClient<Api>
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
