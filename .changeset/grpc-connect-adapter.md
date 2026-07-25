---
'@forinda/kickjs-grpc': minor
---

New package: `@forinda/kickjs-grpc` — Connect RPC transport.

Serves gRPC-Web, the Connect protocol, and (behind an HTTP/2 terminator) native gRPC from the **same app and port** as your HTTP routes. It mounts as connect-style middleware at the `beforeGlobal` phase, so it rides the existing Express/Fastify/h3 server rather than binding a second listener — and lands before `express.json()`, which would otherwise drain the request body Connect needs to read itself.

- `@GrpcService(descriptor)` / `@GrpcMethod(rpc?)` bind a DI-registered class to a generated protobuf service. The `.proto` stays the source of truth for the wire contract.
- `GrpcContext` implements KickJS's transport-neutral `ExecutionContext`, so Context Contributors written with `defineContextDecorator` run against an RPC exactly as they do against an HTTP route — same `dependsOn` topo-sort, same method > class > adapter precedence, same boot-time cycle detection.
- `HttpException` maps to the corresponding Connect code (404 → `NotFound`, 429 → `ResourceExhausted`, …); `ConnectError` passes through untouched; anything else becomes `Internal` with the original kept as `cause`.
- Unary and streaming RPCs both supported; contributors run before the first streamed message.
- Unknown RPC names and contributor cycles abort boot rather than failing the first request that hits them.
- `introspect()` + a `GRPC_ADAPTER` token expose per-method call/failure counts to DevTools.
