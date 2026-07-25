# @forinda/kickjs-grpc

## 0.1.0

### Minor Changes

- [#484](https://github.com/forinda/kick-js/pull/484) [`5b15e9c`](https://github.com/forinda/kick-js/commit/5b15e9c938da53f7e4c60cb6e048c4ef35406e5c) Thanks [@forinda](https://github.com/forinda)! - New package: `@forinda/kickjs-grpc` — Connect RPC transport.

  Serves gRPC-Web, the Connect protocol, and (behind an HTTP/2 terminator) native gRPC from the **same app and port** as your HTTP routes. It mounts as connect-style middleware at the `beforeGlobal` phase, so it rides the existing Express/Fastify/h3 server rather than binding a second listener — and lands before `express.json()`, which would otherwise drain the request body Connect needs to read itself.

  - `@GrpcService(descriptor)` / `@GrpcMethod(rpc?)` bind a DI-registered class to a generated protobuf service. The `.proto` stays the source of truth for the wire contract.
  - `GrpcContext` implements KickJS's transport-neutral `ExecutionContext`, so Context Contributors written with `defineContextDecorator` run against an RPC exactly as they do against an HTTP route — same `dependsOn` topo-sort, same boot-time cycle detection. Of the framework's five registration sites (method > class > module > adapter > global), RPCs participate in method > class > adapter; `module` and `global` are wired to HTTP route mounting and do not reach a non-HTTP transport, so `GrpcAdapter({ contributors })` is the way to cover every RPC.
  - `HttpException` maps to the corresponding Connect code (404 → `NotFound`, 429 → `ResourceExhausted`, …) and its message is sent, since raising one is a deliberate act of describing a fault to the caller; `ConnectError` passes through untouched. Everything else becomes `Internal` with an opaque `"Internal error"` message — unexpected `err.message` values routinely carry SQL, paths, and connection strings, so they are logged server-side and kept on `cause` rather than serialized to the client.
  - Unary and streaming RPCs both supported; contributors run before the first streamed message.
  - Unknown RPC names and contributor cycles abort boot rather than failing the first request that hits them.
  - `introspect()` + a `GRPC_ADAPTER` token expose per-method call/failure counts to DevTools.
