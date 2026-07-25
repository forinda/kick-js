/**
 * @forinda/kickjs-grpc — Connect RPC transport for KickJS.
 *
 * Serves gRPC, gRPC-Web, and the Connect protocol from the same server and
 * port as your HTTP routes. Services are decorated KickJS classes with full
 * DI and Context Contributor support; the `.proto` stays the source of truth
 * for the wire contract.
 *
 * @example
 * ```ts
 * import { bootstrap } from '@forinda/kickjs'
 * import { GrpcAdapter, GrpcService, GrpcMethod, type GrpcContext } from '@forinda/kickjs-grpc'
 * import { UserService } from './gen/user_pb'
 *
 * @GrpcService(UserService)
 * class UserRpc {
 *   @Autowired() private users!: UserRepository
 *
 *   @GrpcMethod()
 *   async getUser(req: GetUserRequest, ctx: GrpcContext) {
 *     return { user: await this.users.findById(req.id) }
 *   }
 * }
 *
 * bootstrap({ modules: [UserModule], adapters: [GrpcAdapter()] })
 * ```
 */

export { GrpcAdapter } from './grpc-adapter'
export { GrpcService, GrpcMethod } from './decorators'
export { GrpcContext } from './grpc-context'
export { toConnectError, codeForStatus, INTERNAL_ERROR_MESSAGE } from './errors'
export { collectServices, buildConnectRoutes } from './router'
export type { BuildConnectRoutesOptions } from './router'

export {
  GRPC_ADAPTER,
  GRPC_METADATA,
  grpcServiceRegistry,
  type GrpcAdapterExtensions,
  type GrpcAdapterOptions,
  type GrpcHandlerDefinition,
  type GrpcNodeRequest,
  type GrpcServiceEntry,
  type GrpcStats,
} from './interfaces'
