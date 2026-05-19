/// <reference types="multer" />
import type { Request, Response, NextFunction } from 'express'
import { type ExecutionContext, type MetaValue } from '../core/execution-context'
import { requestStore } from './request-store'
import {
  parseQuery,
  type QueryFieldConfig,
  type PaginatedResponse,
  type TypedParsedQuery,
} from './query'

/**
 * Recursively marks every property of `T` as `readonly`. Preserves
 * `Function`, `Date`, and `RegExp` unchanged, and converts `Map` / `Set`
 * to `ReadonlyMap` / `ReadonlySet` so their mutating methods (`set`,
 * `delete`, `add`, `clear`) are removed from the public surface.
 * Tuples keep their positional element types — only their per-element
 * mutability is locked.
 *
 * Exposed as a utility for adopters who want to opt into compile-time
 * sealing of their own shapes. **No longer applied to
 * `RequestContext.{body,params,query,headers,file,files}`** — that
 * broke TS narrowing / discriminated-union drilldowns on typed request
 * payloads. Runtime read-only enforcement now lives in
 * {@link makeReadOnlyProxy} (dev-only Proxy that warns on writes,
 * no-op in production).
 *
 * Type-only. No runtime cost. `DeepReadonly<any>` is `any` (TS
 * distributes conditional types over `any`).
 */
export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends Date | RegExp
    ? T
    : T extends Map<infer K, infer V>
      ? ReadonlyMap<DeepReadonly<K>, DeepReadonly<V>>
      : T extends Set<infer V>
        ? ReadonlySet<DeepReadonly<V>>
        : T extends readonly (infer U)[]
          ? // Distinguish a regular array from a tuple. A regular `T[]` widens
            // its `length` to `number`; a tuple's `length` is a literal
            // (e.g. `2`). The literal branch maps over `keyof T` so each
            // positional slot keeps its own type — `DeepReadonly<[1, 2]>` →
            // `readonly [1, 2]`, not `readonly (1 | 2)[]`.
            number extends T['length']
            ? ReadonlyArray<DeepReadonly<U>>
            : { readonly [K in keyof T]: DeepReadonly<T[K]> }
          : T extends object
            ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
            : T

/**
 * Re-export the augmentable {@link ContextMeta} registry from core/.
 * Declared in `core/execution-context.ts` so non-HTTP transports
 * (WS/queue/cron, V2) share one declaration site. Apps still augment
 * via the canonical `declare module '@forinda/kickjs'` form.
 */
export type { ContextMeta } from '../core/execution-context'

/**
 * Symbol key under which the per-request `AbortController` backing
 * `RequestContext.signal` is cached on the Express `req` object.
 * Shared across every `RequestContext` instance built for the same
 * request (router-builder constructs separate wrappers for
 * middleware, the contributor pipeline, and the main handler — they
 * all need the same signal).
 */
const signalControllerKey = Symbol.for('kickjs.requestContext.signalController')

/**
 * Symbol key under which per-target read-only Proxy wrappers are
 * cached on the Express `req` object. Used by {@link makeReadOnlyProxy}
 * so repeat access of `ctx.body` / `ctx.params` / etc. returns the same
 * Proxy instance (cheap, and stable under `===` for adopters comparing
 * values across middleware).
 */
const readOnlyProxyCacheKey = Symbol.for('kickjs.requestContext.readOnlyProxyCache')

/**
 * In dev, wrap `target` in a `Proxy` whose `set` / `deleteProperty`
 * traps log a warning and otherwise leave the underlying object
 * untouched. In production (`process.env.NODE_ENV === 'production'`)
 * returns `target` as-is so the hot path stays zero-cost.
 *
 * Why a Proxy instead of `DeepReadonly<T>` at the type level: the
 * recursive conditional type interfered with TS narrowing (notably
 * discriminated unions on `ctx.body`) and slowed type-checking on
 * deeply-nested Zod-inferred shapes. Compile-time sealing is gone;
 * runtime warning catches the same class of bug during dev and tests.
 *
 * Trap returns `true` so strict-mode call sites (which is all of them
 * — ES modules are strict) don't *throw* on assignment — they just get
 * a warning + the underlying value stays untouched. Adopters discover
 * the violation when the subsequent read returns the original value,
 * not the one they "set".
 *
 * Targets are cached per-`req` under {@link readOnlyProxyCacheKey} so
 * repeat getter access returns the same proxy. Primitives, `null`,
 * and non-object values pass through unchanged.
 */
function makeReadOnlyProxy<T>(target: T, req: object, label: string): T {
  if (process.env.NODE_ENV === 'production') return target
  if (target === null || typeof target !== 'object') return target

  type Cache = WeakMap<object, unknown>
  const reqObj = req as Record<symbol, Cache | undefined>
  let cache = reqObj[readOnlyProxyCacheKey]
  if (!cache) {
    cache = new WeakMap()
    reqObj[readOnlyProxyCacheKey] = cache
  }
  const targetObj = target as unknown as object
  const cached = cache.get(targetObj)
  if (cached) return cached as T

  const proxy = new Proxy(targetObj, {
    set(_t, prop, _value) {
      console.warn(
        `[kickjs] Attempted to assign \`ctx.${label}.${String(prop)}\` — ` +
          `request data is read-only. ` +
          `Stash computed values via \`ctx.set('key', value)\` or a Context Contributor, ` +
          `or reach \`ctx.req.${label}\` if you genuinely need the raw mutable handle.`,
      )
      return true
    },
    deleteProperty(_t, prop) {
      console.warn(
        `[kickjs] Attempted to \`delete ctx.${label}.${String(prop)}\` — ` +
          `request data is read-only. See above for guidance.`,
      )
      return true
    },
  })
  cache.set(targetObj, proxy)
  return proxy as T
}

/**
 * The shape of a single route entry in `KickRoutes`. Generated by
 * `kick typegen` and consumed via the `Ctx<T>` helper. Each field is
 * `unknown` by default and is filled in as the typegen learns more
 * about the route (URL params from the path, body/query from validation
 * schemas, etc.).
 */
export interface RouteShape {
  params?: unknown
  body?: unknown
  query?: unknown
  response?: unknown
}

/**
 * Unified request/response abstraction passed to every controller method.
 * Shields handlers from raw Express objects and provides convenience methods.
 *
 * Implements {@link ExecutionContext} so the transport-agnostic Context
 * Contributor pipeline (#107) can run against this concrete HTTP context
 * the same way it will run against future WS / queue / cron contexts.
 */
export class RequestContext<TBody = any, TParams = any, TQuery = any> implements ExecutionContext {
  constructor(
    public readonly req: Request,
    public readonly res: Response,
    public readonly next: NextFunction,
  ) {}

  /**
   * Read-side accessor for the per-request metadata map.
   *
   * Returns the AsyncLocalStorage map (`requestStore.getStore().values`)
   * shared with the Context Contributor pipeline when an ALS frame is
   * active. Returns `null` outside any frame — read-side callers
   * (`ctx.get`, `ctx.user`, `ctx.tenantId`, `ctx.roles`) treat that as
   * "no metadata" and fall through to their `req.*` defaults. Reads
   * never throw because outside an ALS frame nobody could have written
   * via `ctx.set` anyway, so an empty answer is the truthful one.
   */
  private metadataReadOnly(): Map<string, any> | null {
    return (requestStore.getStore()?.values as Map<string, any> | undefined) ?? null
  }

  /**
   * Write-side accessor for the per-request metadata map.
   *
   * Returns the same map as {@link metadataReadOnly} when an ALS frame
   * is active. Throws otherwise — writing to a fallback map outside
   * the ALS frame would silently lose data because other call sites
   * (downstream contributors, request-logger, etc.) read from the
   * canonical store and would never see it. Mount
   * `requestScopeMiddleware()` (Application does this for you in
   * `'auto'` mode) or wrap your test setup in
   * `requestStore.run({...}, () => …)` to fix.
   */
  private metadataForWrite(): Map<string, any> {
    const store = requestStore.getStore()
    if (store) return store.values as Map<string, any>
    throw new Error(
      'RequestContext.set called outside an AsyncLocalStorage frame. ' +
        'Mount requestScopeMiddleware() before constructing RequestContext, ' +
        'or wrap test setup in requestStore.run({ requestId, instances: new Map(), values: new Map() }, () => ...).',
    )
  }

  // ── Request Data ────────────────────────────────────────────────────

  /**
   * Parsed request body. Wrapped in a dev-only Proxy that warns when
   * adopters try to mutate Zod-validated payloads in place — compute
   * new values and stash them via `ctx.set('key', value)` or a Context
   * Contributor instead. Reach for `ctx.req.body` if you genuinely
   * need the raw, mutable Express handle (rare).
   *
   * In production the Proxy is bypassed and `this.req.body` is
   * returned as-is — no runtime cost on the hot path.
   */
  get body(): TBody {
    return makeReadOnlyProxy<TBody>(this.req.body, this.req, 'body')
  }

  /** Path parameters parsed from the route — read-only, see {@link body}. */
  get params(): TParams {
    return makeReadOnlyProxy<TParams>(this.req.params as TParams, this.req, 'params')
  }

  /** Parsed query string — read-only, see {@link body}. */
  get query(): TQuery {
    return makeReadOnlyProxy<TQuery>(this.req.query as TQuery, this.req, 'query')
  }

  /** Inbound HTTP headers — read-only, see {@link body}. */
  get headers(): Request['headers'] {
    return makeReadOnlyProxy<Request['headers']>(this.req.headers, this.req, 'headers')
  }

  get requestId(): string | undefined {
    return (this.req as any).requestId ?? (this.req.headers['x-request-id'] as string | undefined)
  }

  /**
   * `AbortSignal` that fires when the underlying HTTP request is
   * closed — either because the client disconnected before the
   * response was sent, or because Node's socket-close event ran
   * after a normal response. Multiple `RequestContext` wrappers for
   * the same request (router-builder constructs one per
   * middleware/contributor pipeline / main handler) share a single
   * `AbortController` cached on the underlying `req` object, so the
   * signal is stable across the request lifecycle.
   *
   * Thread it through anything that takes an `AbortSignal` so the
   * work cancels as soon as the client gives up — e.g. a kickjs-db
   * relational query:
   *
   * ```ts
   * @Get('/:id/full')
   * async show(ctx: RequestContext) {
   *   const row = await this.repo.findFullById(ctx.params.id, ctx.signal)
   *   if (!row) return ctx.notFound()
   *   ctx.json(row)
   * }
   * ```
   *
   * The repo passes `signal` to `db.query.<table>.findUnique({ signal })`;
   * if the client disconnects mid-flight, the in-flight query rejects
   * with `RelationalQueryCancelledError` instead of consuming the
   * connection until completion.
   *
   * Implementation note — both `req.on('close')` and `res.on('close')`
   * are wired so the signal aborts regardless of whether the close
   * event lands on the request stream or the response stream first.
   * Subsequent fires are no-ops (`AbortController.abort()` is
   * idempotent).
   */
  get signal(): AbortSignal {
    const req = this.req as Request & { [signalControllerKey]?: AbortController }
    const cached = req[signalControllerKey]
    if (cached) return cached.signal

    const ctrl = new AbortController()
    req[signalControllerKey] = ctrl
    const abort = () => ctrl.abort('request closed')
    this.req.once('close', abort)
    this.res.once('close', abort)
    return ctrl.signal
  }

  /** Session data (requires session middleware) */
  get session(): any {
    return (this.req as any).session
  }

  /**
   * The authenticated user set by AuthAdapter.
   * Reads from the per-request metadata store first (`ctx.set('user', ...)`),
   * then falls back to `req.user` (set directly by AuthAdapter middleware).
   *
   * Extend the `AuthUser` interface via module augmentation in `@forinda/kickjs-auth`
   * to get full typing.
   *
   * @example
   * ```ts
   * @Get('/me')
   * @Authenticated()
   * getProfile(ctx: RequestContext) {
   *   const user = ctx.user
   *   if (!user) return ctx.notFound()
   *   return ctx.json({ user })
   * }
   * ```
   */
  get user(): MetaValue<'user', Record<string, any>> | undefined {
    return this.metadataReadOnly()?.get('user') ?? (this.req as any).user
  }

  /**
   * Tenant identifier for multi-tenant apps. Reads `user.tenantId` —
   * populated either by `AuthAdapter.testMode({ tenantId })`, a tenant
   * resolver middleware, or manually on the strategy's `mapPayload`.
   *
   * Augment `AuthUser` (or `ContextMeta['user']`) to widen the return
   * type if your user shape guarantees a non-`string | undefined` id.
   */
  get tenantId(): string | undefined {
    const u = this.user as Record<string, any> | undefined
    return u?.tenantId
  }

  /**
   * Effective role list for the current user. Prefers `user.tenantRoles`
   * (populated by `AuthAdapterOptions.roleResolver` under a tenant) and
   * falls back to `user.roles`. Returns an empty array when the user is
   * absent or the shape has neither field.
   */
  get roles(): string[] {
    const u = this.user as Record<string, any> | undefined
    return u?.tenantRoles ?? u?.roles ?? []
  }

  // ── Query String Parsing ───────────────────────────────────────────

  /**
   * Parse the request query string into structured filters, sort, pagination, and search.
   * Pass the result to an ORM query builder adapter (Drizzle, Prisma, Sequelize, etc.).
   *
   * Generic over the field config: when passed an inline literal (or
   * `as const`), `filters[].field` and `sort[].field` are narrowed to
   * the exact whitelisted field names. Pass nothing or a non-literal
   * config and you get the loose `string` fallback.
   *
   * @param fieldConfig - Optional whitelist for filterable, sortable, and searchable fields
   *
   * @example
   * ```ts
   * @Get('/')
   * async list(ctx: RequestContext) {
   *   const parsed = ctx.qs({
   *     filterable: ['status', 'priority'],
   *     sortable: ['createdAt', 'title'],
   *   } as const)
   *   parsed.filters[0].field // typed as 'status' | 'priority'
   *   parsed.sort[0].field    // typed as 'createdAt' | 'title'
   * }
   * ```
   */
  qs<TConfig extends QueryFieldConfig | undefined = undefined>(
    fieldConfig?: TConfig,
  ): TypedParsedQuery<TConfig> {
    return parseQuery<TConfig>(this.req.query as Record<string, any>, fieldConfig)
  }

  // ── File Uploads ────────────────────────────────────────────────────

  /**
   * Single uploaded file (requires `@FileUpload({ mode: 'single' })`).
   * Wrapped in a dev-only Proxy that warns on mutation — see {@link body}.
   * File metadata is set by the upload middleware and shouldn't be
   * mutated downstream.
   */
  get file(): Express.Multer.File | undefined {
    const f = this.req.file
    return f ? makeReadOnlyProxy<Express.Multer.File>(f, this.req, 'file') : undefined
  }

  /**
   * Array of uploaded files (requires `@FileUpload({ mode: 'array' })`).
   * The array (and each entry in dev) is wrapped in a read-only Proxy
   * that warns on `push`/`pop` and per-file mutation. Use
   * `ctx.req.files` if you genuinely need the mutable Express handle.
   */
  get files(): Express.Multer.File[] | undefined {
    // multer's `Request['files']` is a union — array (mode: 'array' /
    // 'any') or `{ [fieldname]: File[] }` (mode: 'fields'). The
    // `@FileUpload({ mode: 'array' })` decorator only sets the array
    // shape, but `Request['files']` is the broad union. Narrow back to
    // `File[]` here for the common-case getter; adopters using
    // `mode: 'fields'` can read `ctx.req.files` directly for the
    // dictionary shape.
    const f = this.req.files
    if (!Array.isArray(f)) return undefined
    return makeReadOnlyProxy<Express.Multer.File[]>(f, this.req, 'files')
  }

  // ── Metadata Store ──────────────────────────────────────────────────

  /**
   * Read a value from the per-request metadata store.
   *
   * When `ContextMeta` has been augmented with a matching key, the return
   * type is inferred automatically. For ad-hoc keys, pass a generic:
   * `ctx.get<MyType>('custom')`.
   */
  get<K extends string>(key: K): MetaValue<K> | undefined {
    return this.metadataReadOnly()?.get(key) as MetaValue<K> | undefined
  }

  /**
   * Write a value to the per-request metadata store. Throws when no
   * AsyncLocalStorage frame is active — see {@link metadataForWrite}
   * for why a silent fallback is the wrong default.
   */
  set<K extends string>(key: K, value: MetaValue<K>): void {
    this.metadataForWrite().set(key, value)
  }

  // ── Response Helpers ────────────────────────────────────────────────

  json(data: any, status = 200) {
    return this.res.status(status).json(data)
  }

  created(data: any) {
    return this.res.status(201).json(data)
  }

  noContent() {
    return this.res.status(204).end()
  }

  notFound(message = 'Not Found') {
    return this.res.status(404).json({ message })
  }

  badRequest(message: string) {
    return this.res.status(400).json({ message })
  }

  html(content: string, status = 200) {
    return this.res.status(status).type('html').send(content)
  }

  download(buffer: Buffer, filename: string, contentType = 'application/octet-stream') {
    this.res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    this.res.setHeader('Content-Type', contentType)
    return this.res.send(buffer)
  }

  /**
   * Render a template using the registered view engine (EJS, Pug, Handlebars, etc.).
   * Requires a ViewAdapter to be configured in bootstrap().
   *
   * @param template - Template name (without extension, relative to viewsDir)
   * @param data - Data to pass to the template
   *
   * @example
   * ```ts
   * ctx.render('dashboard', { user, title: 'Dashboard' })
   * ctx.render('emails/welcome', { name: 'Alice' })
   * ```
   */
  render(template: string, data: Record<string, any> = {}) {
    return this.res.render(template, data)
  }

  /**
   * Parse query params and return a standardized paginated response.
   * Calls `ctx.qs()` internally, then wraps your data with pagination meta.
   *
   * @param fetcher - Async function that receives ParsedQuery and returns `{ data, total }`
   * @param fieldConfig - Optional whitelist for filterable, sortable, searchable fields
   *
   * @example
   * ```ts
   * @Get('/')
   * async list(ctx: RequestContext) {
   *   return ctx.paginate(
   *     async (parsed) => {
   *       const data = await db.select().from(users)
   *         .where(query.where).limit(parsed.pagination.limit)
   *         .offset(parsed.pagination.offset).all()
   *       const total = await db.select({ count: count() }).from(users).get()
   *       return { data, total: total?.count ?? 0 }
   *     },
   *     { filterable: ['name', 'role'], sortable: ['createdAt'] },
   *   )
   * }
   * ```
   */
  async paginate<T, TConfig extends QueryFieldConfig | undefined = undefined>(
    fetcher: (parsed: TypedParsedQuery<TConfig>) => Promise<{ data: T[]; total: number }>,
    fieldConfig?: TConfig,
  ) {
    const parsed = this.qs<TConfig>(fieldConfig)
    const { data, total } = await fetcher(parsed)
    const { page, limit } = parsed.pagination
    const totalPages = Math.ceil(total / limit) || 1

    const response: PaginatedResponse<T> = {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    }

    return this.json(response)
  }

  // ── Server-Sent Events ──────────────────────────────────────────────

  /**
   * Start an SSE (Server-Sent Events) stream.
   * Sets the correct headers and returns helpers to send events.
   *
   * @example
   * ```ts
   * @Get('/events')
   * async stream(ctx: RequestContext) {
   *   const sse = ctx.sse()
   *
   *   const interval = setInterval(() => {
   *     sse.send({ time: new Date().toISOString() }, 'tick')
   *   }, 1000)
   *
   *   sse.onClose(() => clearInterval(interval))
   * }
   * ```
   */
  sse() {
    this.res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    this.res.flushHeaders()

    const closeCallbacks: Array<() => void> = []

    this.req.on('close', () => {
      for (const cb of closeCallbacks) cb()
    })

    return {
      /** Send an SSE event with optional event name and id */
      send: (data: any, event?: string, id?: string) => {
        if (id) this.res.write(`id: ${id}\n`)
        if (event) this.res.write(`event: ${event}\n`)
        this.res.write(`data: ${JSON.stringify(data)}\n\n`)
      },
      /** Send a comment (keeps connection alive) */
      comment: (text: string) => {
        this.res.write(`: ${text}\n\n`)
      },
      /** Register a callback when the client disconnects */
      onClose: (fn: () => void) => {
        closeCallbacks.push(fn)
      },
      /** End the SSE stream */
      close: () => {
        this.res.end()
      },
    }
  }
}

/**
 * Short alias for `RequestContext` parameterised by a route shape.
 *
 * Use with `kick typegen`'s generated `KickRoutes` namespace for
 * fully-typed `ctx.params`, `ctx.body`, and `ctx.query`. Metadata
 * typing (`ctx.get()`, `ctx.set()`, `ctx.user`) comes from
 * `ContextMeta` augmentation and works on all `RequestContext` instances.
 *
 * @example
 * ```ts
 * @Get('/:id')
 * getUser(ctx: Ctx<KickRoutes.UserController['getUser']>) {
 *   ctx.params.id      // typed from RouteShape
 *   ctx.body           // typed from RouteShape
 *   ctx.user           // typed from ContextMeta
 *   ctx.get('tenant')  // typed from ContextMeta
 * }
 * ```
 */
export type Ctx<TRoute extends RouteShape = RouteShape> = RequestContext<
  TRoute extends { body: infer B } ? B : any,
  TRoute extends { params: infer P } ? P : any,
  TRoute extends { query: infer Q } ? Q : any
>

/**
 * Global ambient registry of typed routes, populated by `kick typegen`.
 *
 * Each interface inside `KickRoutes` corresponds to a controller class;
 * each property is one route method on that controller. The values
 * conform to `RouteShape`.
 *
 * Empty by default — declarations come from `.kickjs/types/routes.d.ts`
 * generated alongside the rest of the typegen output.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace KickRoutes {}
}
