# @forinda/kickjs-grpc

Connect RPC transport for [KickJS](https://kickjs.app) — serve **gRPC, gRPC-Web, and the Connect protocol from the same app and the same port** as your HTTP routes.

Services are ordinary KickJS classes. `@GrpcService` binds a class to a generated protobuf descriptor, `@GrpcMethod` binds a method to an RPC, and handlers get the full framework: `@Autowired` DI, the Context Contributor pipeline, and `HttpException` error mapping.

```bash
pnpm add @forinda/kickjs-grpc @connectrpc/connect @connectrpc/connect-node @bufbuild/protobuf
```

## Quick start

The `.proto` stays the source of truth for the wire contract. Generate descriptors with [`buf`](https://buf.build) + `protoc-gen-es`, then implement:

```proto
// proto/user/v1/user.proto
syntax = "proto3";
package user.v1;

message GetUserRequest  { string id = 1; }
message GetUserResponse { string id = 1; string email = 2; }

service UserService {
  rpc GetUser(GetUserRequest) returns (GetUserResponse);
}
```

```ts
// src/modules/user/user.rpc.ts
import { Autowired, HttpException } from '@forinda/kickjs'
import { GrpcService, GrpcMethod, type GrpcContext } from '@forinda/kickjs-grpc'
import { UserService, type GetUserRequest } from '../../gen/user/v1/user_pb'
import { UserRepository } from './user.repository'

@GrpcService(UserService)
export class UserRpc {
  @Autowired() private users!: UserRepository

  @GrpcMethod()
  async getUser(req: GetUserRequest, ctx: GrpcContext) {
    const user = await this.users.findById(req.id)
    if (!user) throw HttpException.notFound(`No user ${req.id}`) // → Code.NotFound
    return { id: user.id, email: user.email }
  }
}
```

```ts
// src/index.ts
import { bootstrap } from '@forinda/kickjs'
import { GrpcAdapter } from '@forinda/kickjs-grpc'

await bootstrap({
  modules: [UserModule()],
  adapters: [GrpcAdapter()],
})
```

Smoke-test it without generating a client — the Connect protocol is plain JSON over HTTP:

```bash
curl -X POST http://localhost:3000/user.v1.UserService/GetUser \
  -H 'Content-Type: application/json' -d '{"id":"1"}'
```

## Which protocols actually work

The adapter mounts as middleware on the KickJS HTTP server, which speaks **HTTP/1.1**. That determines what reaches you:

| Protocol        | Over the KickJS server | Notes                                    |
| --------------- | ---------------------- | ---------------------------------------- |
| **Connect**     | ✅                     | JSON or binary over HTTP/1.1. Curl-able. |
| **gRPC-Web**    | ✅                     | What browsers use. No proxy needed.      |
| **native gRPC** | ❌                     | Needs HTTP/2 **and** HTTP trailers.      |

To serve native gRPC clients, terminate HTTP/2 in front of the app — Envoy, nginx, a service mesh, Cloud Run, or any HTTP/2-capable ingress — and let it forward to the KickJS server. The RPC paths are identical either way, so nothing in your service code changes.

This is also why `prefix` defaults to empty: most native gRPC client implementations hard-code the `/package.Service/Method` path and cannot send a prefix. Note that this puts RPCs at the **root**, not under `apiPrefix` — `/user.v1.UserService/GetUser`, while HTTP routes stay at `/api/v1/...`.

## Context Contributors

`GrpcContext` implements KickJS's transport-neutral `ExecutionContext`, so contributors written with `defineContextDecorator` work on RPCs exactly as they do on HTTP routes — same `dependsOn` topo-sort, same boot-time cycle detection.

**Three of the framework's five registration sites apply.** The full chain is **method > class > module > adapter > global**; RPCs participate in **method > class > adapter**. The `module` and `global` levels are HTTP-only by construction — `AppModule.contributors()` merges when a module mounts its _routes_, and `bootstrap({ contributors })` feeds the HTTP route table. Neither reaches a non-HTTP transport; use `GrpcAdapter({ contributors })` to cover every RPC.

```ts
const LoadTenant = defineContextDecorator({
  key: 'tenant',
  deps: { repo: TENANT_REPO },
  resolve: (ctx, { repo }) => repo.findById(ctx.get('tenantId')!),
})

@GrpcService(BillingService)
export class BillingRpc {
  @LoadTenant
  @GrpcMethod()
  charge(req: ChargeRequest, ctx: GrpcContext) {
    const tenant = ctx.require('tenant') // throws if the contributor didn't run
    return { ok: true, tenant: tenant.id }
  }
}
```

Apply them at the adapter level to cover every RPC:

```ts
GrpcAdapter({ contributors: [LoadTenant.registration] })
```

## The context object

```ts
ctx.service // 'user.v1.UserService'
ctx.method // 'GetUser'
ctx.protocol // 'connect' | 'grpc' | 'grpc-web'
ctx.headers // incoming gRPC metadata (Headers)
ctx.header(name) // single metadata entry, case-insensitive
ctx.responseHeader // outgoing headers
ctx.responseTrailer
ctx.signal // aborts on deadline / client cancel
ctx.deadlineMs // ms remaining, or undefined
ctx.requestId // x-request-id, or a generated UUID
ctx.get / set / require // ExecutionContext — shared with HTTP
ctx.handler // raw Connect HandlerContext (escape hatch)
```

## Error mapping

Throw what you already throw. `HttpException` maps by status and its message **is** sent — raising one is a deliberate act of describing a fault to the caller. A `ConnectError` passes through untouched.

**Anything else is redacted.** A plain `Error`, a `MissingContextValueError`, or a non-`Error` throw becomes `Code.Internal` with the opaque message `"Internal error"`. The original never reaches the client — `err.message` routinely carries SQL, absolute paths, and connection strings — but it is logged server-side at `error` level with the RPC name, and kept on `ConnectError.cause`. To disclose a real message, throw a `ConnectError` / `HttpException` or map it through `onError`.

| HTTP     | Connect code         |     | HTTP     | Connect code        |
| -------- | -------------------- | --- | -------- | ------------------- |
| 400, 422 | `InvalidArgument`    |     | 429, 413 | `ResourceExhausted` |
| 401      | `Unauthenticated`    |     | 500      | `Internal`          |
| 403      | `PermissionDenied`   |     | 501, 405 | `Unimplemented`     |
| 404      | `NotFound`           |     | 503      | `Unavailable`       |
| 409      | `AlreadyExists`      |     | 504, 408 | `DeadlineExceeded`  |
| 412      | `FailedPrecondition` |     | 416      | `OutOfRange`        |

Rewrite anything else with `onError`:

```ts
GrpcAdapter({
  onError: (err, { service, method }) => {
    // The adapter already logs Code.Internal failures — add this only for
    // your own reporting (Sentry, metrics, an audit trail).
    reportToSentry(err, { service, method })
    return new ConnectError('Service unavailable', Code.Unavailable)
  },
})
```

## Streaming

Server-streaming and bidi RPCs are async generators. Contributors run before the first message is yielded:

```ts
@GrpcMethod()
async *watchOrders(req: WatchRequest, ctx: GrpcContext) {
  for await (const order of this.orders.subscribe(req.customerId, ctx.signal)) {
    yield { order }
  }
}
```

## Options

```ts
GrpcAdapter({
  prefix: '', // '' by default — see the protocol table above
  grpc: true, // binary gRPC (needs HTTP/2 in front)
  grpcWeb: true,
  connect: true,
  contributors: [], // every RPC, at 'adapter' precedence (see above)
  routes: (router) => {}, // register services Connect-style, bypassing decorators
  readMaxBytes: undefined,
  writeMaxBytes: undefined,
  onError: undefined,
})
```

## Failure modes that abort boot

Deliberately loud, so they never surface as a request-time surprise:

- `@GrpcMethod('nope')` naming an RPC the descriptor doesn't declare — the error lists the RPCs that _are_ declared.
- A contributor dependency cycle, or a `dependsOn` key nothing produces.

RPCs declared in the proto but not implemented are **not** an error — Connect answers them with `Code.Unimplemented`.

## Introspection

```ts
const grpc = container.resolve(GRPC_ADAPTER)
grpc.listServices() // ['user.v1.UserService']
grpc.getStats() // { services, methods, callsTotal, callsFailed, byMethod }
```

The adapter also implements `introspect()`, so it shows up in the KickJS DevTools topology view.

## License

MIT
