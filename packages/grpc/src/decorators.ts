import { Service, setClassMeta, pushClassMeta } from '@forinda/kickjs'
import type { DescService } from '@bufbuild/protobuf'
import { GRPC_METADATA, grpcServiceRegistry, type GrpcHandlerDefinition } from './interfaces'

/**
 * Mark a class as the implementation of a protobuf service. Registers the
 * class in the DI container (so `@Autowired` works inside it) and in the
 * gRPC service registry the adapter reads at boot.
 *
 * The `service` argument is the generated `DescService` — the export
 * `protoc-gen-es` emits for each `service` block in your `.proto`. The proto
 * stays the source of truth for the wire contract; the decorator only binds
 * an implementation to it.
 *
 * @example
 * ```ts
 * import { UserService } from './gen/user_pb'
 *
 * @GrpcService(UserService)
 * export class UserRpc {
 *   @Autowired() private users!: UserRepository
 *
 *   @GrpcMethod()
 *   async getUser(req: GetUserRequest, ctx: GrpcContext) {
 *     return { user: await this.users.findById(req.id) }
 *   }
 * }
 * ```
 */
export function GrpcService(service: DescService): ClassDecorator {
  return (target: any) => {
    Service()(target)
    setClassMeta(GRPC_METADATA.SERVICE, service, target)
    grpcServiceRegistry.add(target)
  }
}

/**
 * Bind a class method to an RPC on the enclosing `@GrpcService`.
 *
 * The RPC name defaults to the class method's own name, which matches the
 * `localName` `protoc-gen-es` generates (lowerCamelCase). Pass `rpc`
 * explicitly when the two diverge — e.g. when the method name collides with
 * something else on the class.
 *
 * Unimplemented RPCs are not an error: Connect answers any RPC declared in
 * the proto but missing here with `Code.Unimplemented`.
 *
 * @example
 * ```ts
 * @GrpcMethod()          // binds to the `say` RPC
 * say(req: SayRequest, ctx: GrpcContext) { … }
 *
 * @GrpcMethod('say')     // same, named explicitly
 * handleSay(req: SayRequest, ctx: GrpcContext) { … }
 * ```
 */
export function GrpcMethod(rpc?: string): MethodDecorator {
  return (target, propertyKey) => {
    const handlerName = propertyKey as string
    pushClassMeta<GrpcHandlerDefinition>(GRPC_METADATA.HANDLERS, target.constructor, {
      rpc: rpc ?? handlerName,
      handlerName,
    })
  }
}
