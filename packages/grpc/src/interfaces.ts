import { createToken, type ContributorRegistrations } from '@forinda/kickjs'
import type { DescService } from '@bufbuild/protobuf'
import type { ConnectRouter } from '@connectrpc/connect'
import type { IncomingMessage } from 'node:http'

/** Metadata keys owned by this package. Namespaced to avoid collisions. */
export const GRPC_METADATA = {
  /** `DescService` the class implements — set by `@GrpcService`. */
  SERVICE: 'kick:grpc:service',
  /** `GrpcHandlerDefinition[]` — pushed by `@GrpcMethod`. */
  HANDLERS: 'kick:grpc:handlers',
} as const

/**
 * Registry of every class decorated with `@GrpcService`. Populated at class
 * definition time (decorators fire on import), read once at `beforeMount`.
 * Mirrors `wsControllerRegistry` in `@forinda/kickjs-ws`.
 */
export const grpcServiceRegistry = new Set<any>()

/** One `@GrpcMethod`-decorated method on a `@GrpcService` class. */
export interface GrpcHandlerDefinition {
  /** RPC name as declared in the proto (localName on `DescService.method`). */
  rpc: string
  /** Class method that implements it. */
  handlerName: string
}

/** Snapshot of RPC traffic — consumed by DevTools and `getStats()`. */
export interface GrpcStats {
  services: number
  methods: number
  callsTotal: number
  callsFailed: number
  /** Per-`package.Service/Method` call counts. */
  byMethod: Record<string, { calls: number; failed: number }>
}

/** DI token exposing the adapter's public surface (stats, registry). */
export const GRPC_ADAPTER = createToken<GrpcAdapterExtensions>('kick/grpc/Adapter')

/** Public surface an adapter instance exposes beyond the `AppAdapter` contract. */
export interface GrpcAdapterExtensions {
  /** Current RPC stats snapshot. */
  getStats(): GrpcStats
  /** Fully-qualified names of every mounted service, in mount order. */
  listServices(): string[]
}

/** Options accepted by {@link GrpcAdapter}. */
export interface GrpcAdapterOptions {
  /**
   * Serve every RPC under this path prefix — `/rpc` exposes
   * `foo.FooService/Bar` at `/rpc/foo.FooService/Bar`.
   *
   * Defaults to `''` (no prefix). **Leave it unset if native gRPC clients
   * must reach the server**: most gRPC implementations hard-code the
   * `/package.Service/Method` path and cannot send a prefix. A prefix is
   * safe for Connect and gRPC-Web clients.
   */
  prefix?: string
  /**
   * Enable the binary gRPC protocol. Defaults to `true`.
   *
   * Mind the transport: the gRPC protocol requires HTTP/2 and access to
   * HTTP trailers. When this adapter is mounted on the KickJS HTTP server
   * (which is HTTP/1.1), gRPC-Web and Connect clients work but native gRPC
   * clients do not — see the README for the HTTP/2 options.
   */
  grpc?: boolean
  /** Enable the gRPC-Web protocol (works over HTTP/1.1). Defaults to `true`. */
  grpcWeb?: boolean
  /** Enable the Connect protocol — JSON over HTTP, curl-able. Defaults to `true`. */
  connect?: boolean
  /**
   * Context Contributors applied to every RPC on every service, at the
   * `'adapter'` precedence level — they lose to `@GrpcService`-class and
   * per-method contributors, matching the HTTP precedence order.
   */
  contributors?: ContributorRegistrations
  /**
   * Escape hatch for registering services Connect-style, bypassing
   * decorators. Runs after decorated services are registered, so it can
   * also override them.
   */
  routes?: (router: ConnectRouter) => void
  /**
   * Maximum size in bytes of a single message. Passed through to Connect;
   * defaults to Connect's own limit when unset.
   */
  readMaxBytes?: number
  /** Maximum size in bytes of a message to write. Passed through to Connect. */
  writeMaxBytes?: number
  /**
   * Called when an RPC handler throws something that is not already a
   * `ConnectError` or `HttpException`. Return a `ConnectError` to control
   * the wire response, or `undefined` to fall back to `Code.Internal`.
   */
  onError?: (err: unknown, info: { service: string; method: string }) => unknown
}

/** Everything a resolved service descriptor + its handlers need to mount. */
export interface GrpcServiceEntry {
  serviceClass: any
  descriptor: DescService
  handlers: GrpcHandlerDefinition[]
}

/**
 * Node request as Connect sees it. Re-exported so consumers writing
 * `contextValues`-style hooks don't need a direct `connect-node` import.
 */
export type GrpcNodeRequest = IncomingMessage
