import { randomUUID } from 'node:crypto'
import { MissingContextValueError, type ExecutionContext, type MetaValue } from '@forinda/kickjs'
import type { HandlerContext } from '@connectrpc/connect'

/**
 * Per-RPC execution context handed to every `@GrpcMethod` handler as its
 * second argument.
 *
 * Implements KickJS's transport-neutral {@link ExecutionContext}, so Context
 * Contributors written with `defineContextDecorator` run against an RPC
 * exactly as they do against an HTTP route — same `ctx.get` / `ctx.set` /
 * `ctx.require`, same `dependsOn` topo-sort, same precedence rules.
 *
 * Everything gRPC-specific (headers, trailers, deadline, cancellation) hangs
 * off the same object, and {@link handler} is the unmodified Connect
 * `HandlerContext` for anything this surface doesn't cover.
 *
 * @example
 * ```ts
 * const LoadTenant = defineContextDecorator({
 *   key: 'tenant',
 *   deps: { repo: TENANT_REPO },
 *   resolve: (ctx, { repo }) => repo.findById(ctx.get('tenantHeader')!),
 * })
 *
 * @GrpcService(BillingService)
 * class BillingRpc {
 *   @LoadTenant
 *   @GrpcMethod()
 *   charge(req: ChargeRequest, ctx: GrpcContext) {
 *     const tenant = ctx.require('tenant')      // throws if the contributor didn't run
 *     ctx.responseHeader.set('x-charged-by', tenant.id)
 *     return { ok: true }
 *   }
 * }
 * ```
 */
export class GrpcContext implements ExecutionContext {
  /** Per-RPC metadata written by contributors and read via {@link get}. */
  private readonly metadata = new Map<string, unknown>()

  /** Memoized {@link requestId} — generated once per RPC when no header carries one. */
  private _requestId?: string

  constructor(
    /**
     * The raw Connect handler context. Escape hatch for anything this class
     * doesn't wrap — `values` (Connect's own `ContextValues`), `timeoutMs()`,
     * protocol internals.
     */
    readonly handler: HandlerContext,
  ) {}

  /** Fully-qualified proto service name, e.g. `acme.user.v1.UserService`. */
  get service(): string {
    return this.handler.service.typeName
  }

  /** RPC name as declared in the proto, e.g. `GetUser`. */
  get method(): string {
    return this.handler.method.name
  }

  /** Wire protocol serving this call — `connect`, `grpc`, or `grpc-web`. */
  get protocol(): string {
    return this.handler.protocolName
  }

  /** The URL the server received. */
  get url(): string {
    return this.handler.url
  }

  /** Incoming request headers — gRPC metadata, as a `Headers` object. */
  get headers(): Headers {
    return this.handler.requestHeader
  }

  /**
   * Outgoing response headers. For streaming responses these must be set
   * before the first message is yielded.
   */
  get responseHeader(): Headers {
    return this.handler.responseHeader
  }

  /** Outgoing response trailers. */
  get responseTrailer(): Headers {
    return this.handler.responseTrailer
  }

  /**
   * Aborts when the deadline passes, when the client cancels, or when the
   * RPC completes. Pass it to downstream `fetch` / DB calls to cancel work
   * the caller has already given up on.
   */
  get signal(): AbortSignal {
    return this.handler.signal
  }

  /** Milliseconds left before the caller's deadline, or `undefined` if none. */
  get deadlineMs(): number | undefined {
    return this.handler.timeoutMs()
  }

  /** Read a single request header (gRPC metadata entry), case-insensitively. */
  header(name: string): string | undefined {
    return this.handler.requestHeader.get(name) ?? undefined
  }

  /**
   * Correlation id for this call: the incoming `x-request-id` metadata when
   * the caller sent one, otherwise a UUID generated once and reused for the
   * lifetime of the RPC.
   */
  get requestId(): string {
    if (this._requestId === undefined) {
      this._requestId = this.handler.requestHeader.get('x-request-id') ?? randomUUID()
    }
    return this._requestId
  }

  /** Read a typed value from per-RPC metadata. Always `| undefined`. */
  get<K extends string>(key: K): MetaValue<K> | undefined {
    return this.metadata.get(key) as MetaValue<K> | undefined
  }

  /**
   * Read a value that must be present, throwing `MissingContextValueError`
   * when it isn't — so a contributor that silently didn't run fails loudly
   * instead of surfacing as `undefined` deep in business logic. Only
   * `undefined` throws; `null` is a real value.
   */
  require<K extends string>(key: K): Exclude<MetaValue<K>, undefined> {
    const value = this.metadata.get(key)
    if (value === undefined) throw new MissingContextValueError(key)
    return value as Exclude<MetaValue<K>, undefined>
  }

  /** Write a typed value into per-RPC metadata. */
  set<K extends string>(key: K, value: MetaValue<K>): void {
    this.metadata.set(key, value)
  }
}
