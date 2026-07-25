import {
  createLogger,
  defineAdapter,
  ref,
  type AdapterMiddleware,
  type IntrospectionSnapshot,
  type SourcedRegistration,
} from '@forinda/kickjs'
import { connectNodeAdapter } from '@connectrpc/connect-node'
import type { NextFunction, Request, Response } from 'express'
import {
  GRPC_ADAPTER,
  type GrpcAdapterExtensions,
  type GrpcAdapterOptions,
  type GrpcServiceEntry,
  type GrpcStats,
} from './interfaces'
import { buildConnectRoutes, collectServices } from './router'

const log = createLogger('GrpcAdapter')

/**
 * Carries the connect-middleware `next` across into Connect's `fallback`,
 * which only receives `(req, res)`. Symbol-keyed so it can't collide with
 * anything else riding on the request object.
 */
const NEXT = Symbol.for('kick.grpc.next')

/**
 * Connect RPC transport for KickJS — serves gRPC, gRPC-Web, and the Connect
 * protocol from the **same server and port** as your HTTP routes.
 *
 * Services are plain KickJS classes: `@GrpcService(descriptor)` binds a class
 * to a generated protobuf service, `@GrpcMethod()` binds a method to an RPC,
 * and handlers get full DI (`@Autowired`) plus the Context Contributor
 * pipeline (`defineContextDecorator`) that HTTP routes use.
 *
 * ## Transport reality check
 *
 * The adapter mounts as connect-style middleware on the KickJS HTTP server,
 * which speaks HTTP/1.1. Over that transport:
 *
 * - **Connect protocol** — works. JSON over HTTP, curl-able.
 * - **gRPC-Web** — works. This is what browsers use.
 * - **native gRPC** — does *not*. The binary gRPC protocol needs HTTP/2 and
 *   HTTP trailers. Terminate with an HTTP/2-capable proxy (Envoy, nginx,
 *   Cloud Run, a service mesh) in front, or run a second listener.
 *
 * Because of that, the adapter leaves {@link GrpcAdapterOptions.prefix}
 * empty by default — most native gRPC clients cannot send a path prefix.
 *
 * @example
 * ```ts
 * import { bootstrap } from '@forinda/kickjs'
 * import { GrpcAdapter } from '@forinda/kickjs-grpc'
 *
 * bootstrap({
 *   modules: [UserModule],
 *   adapters: [GrpcAdapter()],
 * })
 * ```
 *
 * ```bash
 * # Connect protocol — no client codegen needed to smoke-test:
 * curl -X POST http://localhost:3000/acme.user.v1.UserService/GetUser \
 *   -H 'Content-Type: application/json' -d '{"id":"1"}'
 * ```
 */
export const GrpcAdapter = defineAdapter<GrpcAdapterOptions, GrpcAdapterExtensions>({
  name: 'GrpcAdapter',
  defaults: {
    prefix: '',
    grpc: true,
    grpcWeb: true,
    connect: true,
  },
  build: (options) => {
    let nodeHandler: ((req: any, res: any) => void) | null = null
    let entries: GrpcServiceEntry[] = []

    const callsTotal = ref(0)
    const callsFailed = ref(0)
    const byMethod = new Map<string, { calls: number; failed: number }>()

    const bump = (key: string, field: 'calls' | 'failed'): void => {
      const row = byMethod.get(key) ?? { calls: 0, failed: 0 }
      row[field]++
      byMethod.set(key, row)
    }

    const methodCount = (): number => entries.reduce((sum, e) => sum + e.handlers.length, 0)

    const getStats = (): GrpcStats => ({
      services: entries.length,
      methods: methodCount(),
      callsTotal: callsTotal.value,
      callsFailed: callsFailed.value,
      byMethod: Object.fromEntries(byMethod),
    })

    const listServices = (): string[] => entries.map((e) => e.descriptor.typeName)

    return {
      getStats,
      listServices,

      /**
       * Mounted at `beforeGlobal` — after in-flight tracking and the
       * request-scope ALS frame, but **before** the global middleware stack.
       * That last part matters: Connect reads the raw request body itself, so
       * `express.json()` must not consume the stream first.
       */
      middleware(): AdapterMiddleware[] {
        return [
          {
            phase: 'beforeGlobal',
            handler: (req: Request, res: Response, next: NextFunction) => {
              if (nodeHandler === null) {
                next()
                return
              }
              ;(req as any)[NEXT] = next
              nodeHandler(req, res)
            },
          },
        ]
      },

      beforeMount({ container: containerArg }) {
        entries = collectServices()

        if (entries.length === 0) {
          log.warn(
            'No @GrpcService classes found — is the module holding them passed to bootstrap({ modules })?',
          )
          return
        }

        const adapterContributors: SourcedRegistration[] = (options.contributors ?? []).map(
          (registration, i): SourcedRegistration => ({
            source: 'adapter',
            registration,
            label: `GrpcAdapter#${i}(${registration.key})`,
          }),
        )

        // Throws on an unknown RPC name, a contributor cycle, or a missing
        // `dependsOn` key — all of which abort boot rather than surfacing on
        // the first request that happens to hit the broken RPC.
        const routes = buildConnectRoutes({
          container: containerArg,
          entries,
          adapterContributors,
          onCall: (key) => {
            callsTotal.value++
            bump(key, 'calls')
          },
          onFailure: (key) => {
            callsFailed.value++
            bump(key, 'failed')
          },
          onError: options.onError,
        })

        const prefix = options.prefix?.trim() ?? ''

        nodeHandler = connectNodeAdapter({
          routes: (router) => {
            routes(router)
            options.routes?.(router)
          },
          // Connect answers 404 itself when no fallback is given; we hand the
          // request back to the KickJS pipeline instead so HTTP routes on the
          // same port still resolve.
          fallback: (req, res) => {
            const next = (req as any)[NEXT]
            if (typeof next === 'function') {
              next()
              return
            }
            res.writeHead(404)
            res.end()
          },
          requestPathPrefix: prefix === '' ? undefined : prefix,
          grpc: options.grpc,
          grpcWeb: options.grpcWeb,
          connect: options.connect,
          ...(options.readMaxBytes !== undefined ? { readMaxBytes: options.readMaxBytes } : {}),
          ...(options.writeMaxBytes !== undefined ? { writeMaxBytes: options.writeMaxBytes } : {}),
        })

        const protocols = [
          options.connect !== false ? 'connect' : null,
          options.grpcWeb !== false ? 'grpc-web' : null,
          options.grpc !== false ? 'grpc' : null,
        ].filter(Boolean)

        for (const entry of entries) {
          log.info(
            `Registered gRPC service: ${entry.descriptor.typeName} ` +
              `(${entry.handlers.length} rpc${entry.handlers.length === 1 ? '' : 's'}) ` +
              `→ ${prefix}/${entry.descriptor.typeName}/*`,
          )
        }
        log.info(
          `Connect RPC ready — ${entries.length} service(s), ${methodCount()} method(s), ` +
            `protocols: ${protocols.join(', ')}`,
        )
      },

      beforeStart({ container }) {
        container.registerInstance(GRPC_ADAPTER, { getStats, listServices })
      },

      async onHealthCheck() {
        return {
          name: 'GrpcAdapter',
          status: nodeHandler !== null ? ('up' as const) : ('down' as const),
        }
      },

      introspect(): IntrospectionSnapshot {
        return {
          protocolVersion: 1,
          name: 'GrpcAdapter',
          kind: 'adapter',
          state: {
            mounted: nodeHandler !== null,
            prefix: options.prefix ?? '',
            protocols: {
              connect: options.connect !== false,
              grpcWeb: options.grpcWeb !== false,
              grpc: options.grpc !== false,
            },
            services: listServices(),
          },
          tokens: { provides: [GRPC_ADAPTER.name], requires: [] },
          metrics: {
            services: entries.length,
            methods: methodCount(),
            callsTotal: callsTotal.value,
            callsFailed: callsFailed.value,
          },
        }
      },

      shutdown() {
        // Connect handlers hold no sockets of their own — they ride the
        // KickJS HTTP server, which the Application closes. Drop the handler
        // so in-flight requests arriving mid-shutdown fall through to the
        // normal pipeline instead of being served by a torn-down router.
        nodeHandler = null
        byMethod.clear()
      },
    }
  },
})
