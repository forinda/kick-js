# @forinda/kickjs-grpc

Connect RPC transport for KickJS — serves gRPC, gRPC-Web, and the Connect protocol from the same app and port as your HTTP routes, using the same decorator-driven approach as HTTP controllers.

See the [gRPC guide](../guide/grpc.md) for the full walkthrough.

## Installation

<PmCommand add="@forinda/kickjs-grpc @connectrpc/connect @connectrpc/connect-node @bufbuild/protobuf" />

`@connectrpc/connect`, `@connectrpc/connect-node`, and `@bufbuild/protobuf` are peer dependencies — they carry the protocol implementation and the generated descriptor runtime.

## Quick example

```ts
import { bootstrap, Autowired } from '@forinda/kickjs'
import { GrpcAdapter, GrpcService, GrpcMethod, type GrpcContext } from '@forinda/kickjs-grpc'
import { UserService, type GetUserRequest } from './gen/user_pb'

@GrpcService(UserService)
export class UserRpc {
  @Autowired() private users!: UserRepository

  @GrpcMethod()
  async getUser(req: GetUserRequest, ctx: GrpcContext) {
    return { user: await this.users.findById(req.id) }
  }
}

bootstrap({ modules: [UserModule], adapters: [GrpcAdapter({ prefix: '/rpc' })] })
```

## Exports

### Decorators

| Decorator                  | Description                                                       |
| -------------------------- | ----------------------------------------------------------------- |
| `@GrpcService(descriptor)` | Bind a DI-registered class to a generated protobuf `DescService`  |
| `@GrpcMethod(rpc?)`        | Bind a class method to an RPC (defaults to the method's own name) |

```ts
function GrpcService(service: DescService): ClassDecorator // also registers the class as a @Service()
function GrpcMethod(rpc?: string): MethodDecorator
```

RPCs declared in the proto but not bound to a method answer `Code.Unimplemented`.

### Adapter

| Export         | Description                                                    |
| -------------- | -------------------------------------------------------------- |
| `GrpcAdapter`  | AppAdapter that mounts Connect RPC on the existing HTTP server |
| `GRPC_ADAPTER` | DI token resolving to `{ getStats(), listServices() }`         |

### Context

| Export        | Description                                                          |
| ------------- | -------------------------------------------------------------------- |
| `GrpcContext` | Per-RPC context; implements the transport-neutral `ExecutionContext` |

| Member                     | Description                                                                     |
| -------------------------- | ------------------------------------------------------------------------------- |
| `service` / `method`       | Fully-qualified service name and RPC name from the proto                        |
| `protocol`                 | `connect`, `grpc` or `grpc-web`                                                 |
| `url`                      | URL the server received                                                         |
| `headers` / `header(name)` | Incoming metadata as `Headers`, or one entry case-insensitively                 |
| `responseHeader`           | Outgoing headers (set before the first streamed message)                        |
| `responseTrailer`          | Outgoing trailers                                                               |
| `signal`                   | Aborts on deadline, client cancel, or completion                                |
| `deadlineMs`               | Milliseconds left before the caller's deadline, or `undefined`                  |
| `requestId`                | Incoming `x-request-id`, else a UUID generated once per call                    |
| `get(key)` / `set(key, v)` | Typed per-RPC values written by Context Contributors                            |
| `require(key)`             | Like `get`, but throws `MissingContextValueError` when the value is `undefined` |
| `handler`                  | The raw Connect `HandlerContext` (escape hatch)                                 |

### Errors

| Export                   | Description                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `toConnectError(err)`    | Normalize any thrown value into a `ConnectError`. Unexpected errors are redacted to `INTERNAL_ERROR_MESSAGE`; the original stays on `cause` |
| `INTERNAL_ERROR_MESSAGE` | The opaque message sent for every `Code.Internal` response (`"Internal error"`)                                                             |
| `codeForStatus(n)`       | Map an HTTP status onto the corresponding Connect `Code` (unmapped 5xx → `Code.Internal`)                                                   |

A thrown `HttpException` is mapped through `codeForStatus`, so a 404 reaches the client as `Code.NotFound`, with its message and headers kept. Other errors go out as `Code.Internal` with `INTERNAL_ERROR_MESSAGE`; the original stays on `cause`.

### Lower-level

| Export                     | Description                                               |
| -------------------------- | --------------------------------------------------------- |
| `collectServices()`        | Read decorated service classes out of the registry        |
| `buildConnectRoutes(opts)` | Turn service entries into a Connect `routes` function     |
| `grpcServiceRegistry`      | The `Set` of `@GrpcService`-decorated classes             |
| `GRPC_METADATA`            | Metadata keys this package writes (`SERVICE`, `HANDLERS`) |

### Types

| Export                      | Description                                    |
| --------------------------- | ---------------------------------------------- |
| `GrpcAdapterOptions`        | Options accepted by `GrpcAdapter`              |
| `GrpcAdapterExtensions`     | Public surface behind the `GRPC_ADAPTER` token |
| `GrpcServiceEntry`          | A service class paired with its descriptor     |
| `GrpcHandlerDefinition`     | One `@GrpcMethod` binding                      |
| `GrpcStats`                 | Snapshot returned by `getStats()`              |
| `BuildConnectRoutesOptions` | Input to `buildConnectRoutes`                  |
| `GrpcNodeRequest`           | Node `IncomingMessage`, as Connect sees it     |

`GrpcStats` is `{ services, methods, callsTotal, callsFailed, byMethod: Record<string, { calls, failed }> }`.

## Adapter options

| Option          | Default | Description                                                                                                                                                                                                                       |
| --------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prefix`        | `''`    | Path prefix for all RPCs. Leave empty for native gRPC clients.                                                                                                                                                                    |
| `grpc`          | `true`  | Enable the binary gRPC protocol (requires HTTP/2 in front)                                                                                                                                                                        |
| `grpcWeb`       | `true`  | Enable gRPC-Web (works over HTTP/1.1)                                                                                                                                                                                             |
| `connect`       | `true`  | Enable the Connect protocol (JSON over HTTP, curl-able)                                                                                                                                                                           |
| `contributors`  | `[]`    | Context Contributors applied to every RPC, at the `adapter` level of the **method > class > module > adapter > global** chain. `module` and `global` are HTTP-only and never reach an RPC — this is the way to cover all of them. |
| `routes`        | —       | `(router: ConnectRouter) => void` — register services Connect-style; runs after decorated services, so it can override them                                                                                                       |
| `readMaxBytes`  | —       | Max size of an inbound message                                                                                                                                                                                                    |
| `writeMaxBytes` | —       | Max size of an outbound message                                                                                                                                                                                                   |
| `onError`       | —       | `(err, { service, method }) => unknown` — called for errors that aren't `ConnectError` / `HttpException`; return a `ConnectError` or `undefined` (→ `Code.Internal`)                                                              |

## Protocol support

The adapter rides the KickJS HTTP server, which speaks HTTP/1.1:

| Protocol    | Works | Notes                                                  |
| ----------- | ----- | ------------------------------------------------------ |
| Connect     | ✅    | JSON or binary over HTTP/1.1                           |
| gRPC-Web    | ✅    | Browser clients                                        |
| native gRPC | ❌    | Needs HTTP/2 + trailers — terminate with a proxy first |

## Related

- [gRPC guide](../guide/grpc.md)
- [Context decorators](../guide/context-decorators.md)
