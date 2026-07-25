# @forinda/kickjs-grpc

Connect RPC transport for KickJS — serves gRPC, gRPC-Web, and the Connect protocol from the same app and port as your HTTP routes, using the same decorator-driven approach as HTTP controllers.

See the [gRPC guide](../guide/grpc.md) for the full walkthrough.

## Installation

```bash
pnpm add @forinda/kickjs-grpc @connectrpc/connect @connectrpc/connect-node @bufbuild/protobuf
```

`@connectrpc/connect`, `@connectrpc/connect-node`, and `@bufbuild/protobuf` are peer dependencies — they carry the protocol implementation and the generated descriptor runtime.

## Exports

### Decorators

| Decorator                  | Description                                                       |
| -------------------------- | ----------------------------------------------------------------- |
| `@GrpcService(descriptor)` | Bind a DI-registered class to a generated protobuf `DescService`  |
| `@GrpcMethod(rpc?)`        | Bind a class method to an RPC (defaults to the method's own name) |

### Adapter

| Export         | Description                                                    |
| -------------- | -------------------------------------------------------------- |
| `GrpcAdapter`  | AppAdapter that mounts Connect RPC on the existing HTTP server |
| `GRPC_ADAPTER` | DI token resolving to `{ getStats(), listServices() }`         |

### Context

| Export        | Description                                                          |
| ------------- | -------------------------------------------------------------------- |
| `GrpcContext` | Per-RPC context; implements the transport-neutral `ExecutionContext` |

### Errors

| Export                | Description                                              |
| --------------------- | -------------------------------------------------------- |
| `toConnectError(err)` | Normalize any thrown value into a `ConnectError`         |
| `codeForStatus(n)`    | Map an HTTP status onto the corresponding Connect `Code` |

### Lower-level

| Export                     | Description                                           |
| -------------------------- | ----------------------------------------------------- |
| `collectServices()`        | Read decorated service classes out of the registry    |
| `buildConnectRoutes(opts)` | Turn service entries into a Connect `routes` function |
| `grpcServiceRegistry`      | The `Set` of `@GrpcService`-decorated classes         |
| `GRPC_METADATA`            | Metadata keys this package writes                     |

### Types

| Export                      | Description                                    |
| --------------------------- | ---------------------------------------------- |
| `GrpcAdapterOptions`        | Options accepted by `GrpcAdapter`              |
| `GrpcAdapterExtensions`     | Public surface behind the `GRPC_ADAPTER` token |
| `GrpcServiceEntry`          | A service class paired with its descriptor     |
| `GrpcHandlerDefinition`     | One `@GrpcMethod` binding                      |
| `GrpcStats`                 | Snapshot returned by `getStats()`              |
| `BuildConnectRoutesOptions` | Input to `buildConnectRoutes`                  |

## Adapter options

| Option          | Default | Description                                                        |
| --------------- | ------- | ------------------------------------------------------------------ |
| `prefix`        | `''`    | Path prefix for all RPCs. Leave empty for native gRPC clients.     |
| `grpc`          | `true`  | Enable the binary gRPC protocol (requires HTTP/2 in front)         |
| `grpcWeb`       | `true`  | Enable gRPC-Web (works over HTTP/1.1)                              |
| `connect`       | `true`  | Enable the Connect protocol (JSON over HTTP, curl-able)            |
| `contributors`  | `[]`    | Context Contributors applied to every RPC, at `adapter` precedence |
| `routes`        | —       | Register services Connect-style, bypassing decorators              |
| `readMaxBytes`  | —       | Max size of an inbound message                                     |
| `writeMaxBytes` | —       | Max size of an outbound message                                    |
| `onError`       | —       | Rewrite a failure before it goes on the wire                       |

## Protocol support

The adapter rides the KickJS HTTP server, which speaks HTTP/1.1:

| Protocol    | Works | Notes                                                  |
| ----------- | ----- | ------------------------------------------------------ |
| Connect     | ✅    | JSON or binary over HTTP/1.1                           |
| gRPC-Web    | ✅    | Browser clients                                        |
| native gRPC | ❌    | Needs HTTP/2 + trailers — terminate with a proxy first |
