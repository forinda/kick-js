# @forinda/kickjs-grpc

## 0.1.1

### Patch Changes

- [#604](https://github.com/forinda/kick-js/pull/604) [`bfb9319`](https://github.com/forinda/kick-js/commit/bfb9319d0b9d66c80d874352e93f7c9afcbef4ab) Thanks [@forinda](https://github.com/forinda)! - README corrections and cuts — a version bump so they reach npm.
  
  The README is what npmjs.com renders, and it ships in the tarball, so a fix
  only reaches readers on a publish. These four packages have no code change in
  this release; the bump exists to publish the README.
  
  - **mcp** — `@Roles('admin')` and `@Public()` came from `@forinda/kickjs-auth`,
    which no longer exists. Five passages described the adapter as running an
    "Express pipeline"; it dispatches through the shared HTTP pipeline on any
    runtime. Cut 560 → 176 lines: the auth-pattern walkthrough, three ASCII
    diagrams, the troubleshooting table and an alternative the README itself
    called not-recommended are all in the guide.
  - **schema** — cut 283 → 132. Per-adapter internals, two resolution orders and
    a full Joi adapter implementation live in the guide; the `KickSchema`
    interface and the subpath table, which are the decisions, stay.
  - **grpc** — cut 206 → 121. Kept the protocol-support table.
  - **devtools-kit** — the recommended dependency shape said `>=5.0.0` / `^5.0.0`
    for a package published at 7.0.1.
  
  `@forinda/kickjs`, `-cli` and `-testing` also had README changes and are
  already bumping in this release, so they need no entry here.

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
