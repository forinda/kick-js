import {
  KickError,
  METADATA,
  buildPipeline,
  getClassMeta,
  getClassMetaOrUndefined,
  getMethodMeta,
  runContributors,
  type Container,
  type ContributorRegistration,
  type SourcedRegistration,
} from '@forinda/kickjs'
import type { DescMethod, DescService } from '@bufbuild/protobuf'
import type { ConnectRouter } from '@connectrpc/connect'
import { GRPC_METADATA, grpcServiceRegistry, type GrpcServiceEntry } from './interfaces'
import type { GrpcAdapterOptions, GrpcHandlerDefinition } from './interfaces'
import { GrpcContext } from './grpc-context'
import { toConnectError } from './errors'

/**
 * Read every `@GrpcService` class out of the registry and pair it with its
 * descriptor + `@GrpcMethod` handlers. Classes whose descriptor metadata is
 * missing are skipped — that only happens if the registry was populated by
 * something other than the decorator.
 */
export function collectServices(): GrpcServiceEntry[] {
  const entries: GrpcServiceEntry[] = []

  for (const serviceClass of grpcServiceRegistry) {
    const descriptor = getClassMetaOrUndefined<DescService>(GRPC_METADATA.SERVICE, serviceClass)
    if (descriptor === undefined) continue

    const handlers = getClassMeta<GrpcHandlerDefinition[]>(GRPC_METADATA.HANDLERS, serviceClass, [])

    entries.push({ serviceClass, descriptor, handlers })
  }

  return entries
}

/**
 * Resolve a `@GrpcMethod` name against the descriptor. Accepts either the
 * generated `localName` (`getUser`) or the proto `name` (`GetUser`), because
 * both read naturally at the decorator call site.
 */
function resolveRpc(descriptor: DescService, rpc: string): DescMethod | undefined {
  const byLocalName = descriptor.method[rpc]
  if (byLocalName !== undefined) return byLocalName
  return descriptor.methods.find((m) => m.name === rpc)
}

function unknownRpcError(descriptor: DescService, serviceName: string, rpc: string): KickError {
  const available = descriptor.methods.map((m) => `${m.localName} (${m.name})`).join(', ')
  return new KickError({
    code: 'KICKGRPC01',
    summary: `Unknown RPC "${rpc}" on ${descriptor.typeName}`,
    cause: `\`${serviceName}\` declares @GrpcMethod('${rpc}'), but the service descriptor for
\`${descriptor.typeName}\` has no such RPC.

RPCs declared in the proto: ${available || '(none)'}`,
    fix: `Rename the handler to match one of the RPCs above, or pass the name
explicitly:

  @GrpcMethod('${descriptor.methods[0]?.localName ?? 'someRpc'}')
  ${rpc}(req, ctx) { … }

If you just changed the .proto, re-run your codegen (\`buf generate\`) so the
descriptor and the implementation agree.`,
    docsUrl: 'https://kickjs.app/guide/grpc',
    context: { service: descriptor.typeName, implementation: serviceName, rpc },
  })
}

/** Everything {@link buildConnectRoutes} needs to materialize the router. */
export interface BuildConnectRoutesOptions {
  container: Container
  entries: readonly GrpcServiceEntry[]
  /** Adapter-level contributors, already tagged at the `'adapter'` precedence. */
  adapterContributors?: readonly SourcedRegistration[]
  /** Called once per RPC invocation, before the handler runs. */
  onCall?: (key: string) => void
  /** Called when an RPC ends in an error, after {@link onCall}. */
  onFailure?: (key: string) => void
  /** User hook from {@link GrpcAdapterOptions.onError}. */
  onError?: GrpcAdapterOptions['onError']
}

/**
 * Turn decorated service classes into a Connect `routes` function.
 *
 * The contributor pipeline for each RPC is built **here**, at boot — so a
 * dependency cycle or a missing `dependsOn` key aborts startup rather than
 * failing the first request that happens to hit that RPC. Same guarantee the
 * HTTP router-builder gives.
 *
 * Controller instances are resolved per-call via the DI container, matching
 * HTTP route behavior so request-scoped bindings work identically.
 */
export function buildConnectRoutes(
  options: BuildConnectRoutesOptions,
): (router: ConnectRouter) => void {
  const { container, entries, adapterContributors = [], onCall, onFailure, onError } = options

  // Pre-resolve everything that can fail, before returning the closure, so
  // boot-time errors surface from `beforeMount` with a full stack.
  const prepared = entries.map((entry) => {
    const serviceName = entry.serviceClass.name as string

    const classContributors = getClassMeta<ContributorRegistration[]>(
      METADATA.CLASS_CONTRIBUTORS,
      entry.serviceClass,
      [],
    )

    const methods = entry.handlers.map((handler) => {
      const desc = resolveRpc(entry.descriptor, handler.rpc)
      if (desc === undefined) {
        throw unknownRpcError(entry.descriptor, serviceName, handler.rpc)
      }

      const methodContributors = getMethodMeta<ContributorRegistration[]>(
        METADATA.METHOD_CONTRIBUTORS,
        entry.serviceClass,
        handler.handlerName,
        [],
      )

      const key = `${entry.descriptor.typeName}/${desc.name}`

      let runPipeline: ((ctx: GrpcContext) => Promise<void>) | null = null
      if (
        methodContributors.length > 0 ||
        classContributors.length > 0 ||
        adapterContributors.length > 0
      ) {
        const sources: SourcedRegistration[] = [
          ...methodContributors.map(
            (registration, i): SourcedRegistration => ({
              source: 'method',
              registration,
              label: `${serviceName}.${handler.handlerName}#${i}(${registration.key})`,
            }),
          ),
          ...classContributors.map(
            (registration, i): SourcedRegistration => ({
              source: 'class',
              registration,
              label: `${serviceName}.@class#${i}(${registration.key})`,
            }),
          ),
          ...adapterContributors,
        ]
        const pipeline = buildPipeline(sources, { route: key })
        runPipeline = (ctx) => runContributors({ pipeline, ctx, container })
      }

      return { desc, key, handlerName: handler.handlerName, runPipeline }
    })

    return { entry, serviceName, methods }
  })

  return (router: ConnectRouter) => {
    for (const { entry, methods } of prepared) {
      const impl: Record<string, unknown> = {}

      for (const { desc, key, handlerName, runPipeline } of methods) {
        const streaming =
          desc.methodKind === 'server_streaming' || desc.methodKind === 'bidi_streaming'

        const fail = (err: unknown): never => {
          onFailure?.(key)
          const mapped = onError?.(err, {
            service: entry.descriptor.typeName,
            method: desc.name,
          })
          throw toConnectError(mapped ?? err)
        }

        const invoke = async (req: unknown, ctx: GrpcContext): Promise<unknown> => {
          if (runPipeline) await runPipeline(ctx)
          const instance = container.resolve(entry.serviceClass) as Record<string, any>
          return instance[handlerName](req, ctx)
        }

        if (streaming) {
          // Streaming impls must return an AsyncIterable *synchronously* —
          // an `async` wrapper would hand Connect a Promise instead. An async
          // generator returns the iterable immediately and still lets us await
          // the contributor pipeline before the first message.
          impl[desc.localName] = (req: unknown, handlerCtx: any) => {
            onCall?.(key)
            const ctx = new GrpcContext(handlerCtx)
            return (async function* () {
              try {
                yield* (await invoke(req, ctx)) as AsyncIterable<unknown>
              } catch (err) {
                fail(err)
              }
            })()
          }
        } else {
          impl[desc.localName] = async (req: unknown, handlerCtx: any) => {
            onCall?.(key)
            const ctx = new GrpcContext(handlerCtx)
            try {
              return await invoke(req, ctx)
            } catch (err) {
              return fail(err)
            }
          }
        }
      }

      router.service(entry.descriptor, impl as never)
    }
  }
}
