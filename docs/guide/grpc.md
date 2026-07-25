# gRPC / Connect RPC

`@forinda/kickjs-grpc` serves **gRPC, gRPC-Web, and the Connect protocol from the same app and the same port** as your HTTP routes. It is built on [Connect RPC](https://connectrpc.com), so one handler answers all three protocols.

Services are ordinary KickJS classes with full DI and the same Context Contributor pipeline your HTTP routes use.

```bash
pnpm add @forinda/kickjs-grpc @connectrpc/connect @connectrpc/connect-node @bufbuild/protobuf
```

## Setup

```ts
import { bootstrap } from '@forinda/kickjs'
import { GrpcAdapter } from '@forinda/kickjs-grpc'

bootstrap({
  modules: [UserModule()],
  adapters: [GrpcAdapter()],
})
```

## Which protocols actually work

The adapter mounts as middleware on the KickJS HTTP server, which speaks HTTP/1.1. That determines what reaches you:

| Protocol        | Over the KickJS server | Notes                                    |
| --------------- | ---------------------- | ---------------------------------------- |
| **Connect**     | ✅                     | JSON or binary over HTTP/1.1. Curl-able. |
| **gRPC-Web**    | ✅                     | What browsers use. No proxy needed.      |
| **native gRPC** | ❌                     | Needs HTTP/2 **and** HTTP trailers.      |

To serve native gRPC clients, terminate HTTP/2 in front of the app — Envoy, nginx, a service mesh, Cloud Run, or any HTTP/2-capable ingress — and forward to the KickJS server. RPC paths are identical either way, so service code does not change.

::: warning RPCs are mounted at the root
Because most native gRPC clients hard-code the `/package.Service/Method` path and cannot send a prefix, `prefix` defaults to empty. RPCs therefore sit at the root (`/user.v1.UserService/GetUser`) while HTTP routes keep their `apiPrefix` + version mount (`/api/v1/users`). Set `prefix` only if native gRPC clients are out of scope.
:::

## The proto stays the source of truth

The wire contract lives in your `.proto`. Generate descriptors with [`buf`](https://buf.build) and `protoc-gen-es`; the decorators only bind an implementation to them.

```proto
syntax = "proto3";
package user.v1;

message GetUserRequest  { string id = 1; }
message GetUserResponse { string id = 1; string email = 2; }

service UserService {
  rpc GetUser(GetUserRequest) returns (GetUserResponse);
}
```

## Decorators

### @GrpcService

Binds a class to a generated `DescService`. Registers the class in the DI container, so `@Autowired` works inside it.

```ts
import { Autowired, HttpException } from '@forinda/kickjs'
import { GrpcService, GrpcMethod, type GrpcContext } from '@forinda/kickjs-grpc'
import { UserService } from '../gen/user/v1/user_pb'

@GrpcService(UserService)
export class UserRpc {
  @Autowired() private users!: UserRepository

  @GrpcMethod()
  async getUser(req: GetUserRequest, ctx: GrpcContext) {
    const user = await this.users.findById(req.id)
    if (!user) throw HttpException.notFound(`No user ${req.id}`)
    return { id: user.id, email: user.email }
  }
}
```

### @GrpcMethod

Binds a class method to an RPC. The name defaults to the method's own name (matching the generated `localName`); pass it explicitly when the two diverge. Both the generated name (`getUser`) and the proto name (`GetUser`) are accepted.

```ts
@GrpcMethod()            // → the `getUser` RPC
getUser(req, ctx) {}

@GrpcMethod('GetUser')   // same, named explicitly
handleGetUser(req, ctx) {}
```

RPCs declared in the proto but not implemented are not an error — Connect answers them with `Code.Unimplemented`.

## Trying it without a client

The Connect protocol is plain JSON over HTTP, so `curl` is enough to smoke-test a service:

```bash
curl -X POST http://localhost:3000/user.v1.UserService/GetUser \
  -H 'Content-Type: application/json' -d '{"id":"1"}'
```

## GrpcContext

Every handler receives a `GrpcContext` as its second argument. It implements the transport-neutral [`ExecutionContext`](./context-decorators.md), so `get` / `set` / `require` behave exactly as on an HTTP route.

```ts
ctx.service // 'user.v1.UserService'
ctx.method // 'GetUser'
ctx.protocol // 'connect' | 'grpc' | 'grpc-web'
ctx.headers // incoming gRPC metadata (Headers)
ctx.header(name) // single entry, case-insensitive
ctx.responseHeader // outgoing headers
ctx.responseTrailer // outgoing trailers
ctx.signal // aborts on deadline / client cancel
ctx.deadlineMs // ms remaining, or undefined
ctx.requestId // x-request-id, or a generated UUID
ctx.get / set / require
ctx.handler // raw Connect HandlerContext (escape hatch)
```

## Context Contributors

Contributors written with `defineContextDecorator` work on RPCs unchanged — same `dependsOn` topo-sort, same precedence (**method > class > adapter**), same boot-time cycle detection.

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
    const tenant = ctx.require('tenant')
    return { ok: true, tenant: tenant.id }
  }
}
```

Cover every RPC by registering at the adapter level:

```ts
GrpcAdapter({ contributors: [LoadTenant.registration] })
```

## Streaming

Server-streaming and bidi RPCs are async generators. Contributors run before the first message is yielded, and `ctx.signal` aborts when the caller disconnects.

```ts
@GrpcMethod()
async *watchOrders(req: WatchRequest, ctx: GrpcContext) {
  for await (const order of this.orders.subscribe(req.customerId, ctx.signal)) {
    yield { order }
  }
}
```

## Errors

Throw what you already throw. `HttpException` maps by status, a `ConnectError` passes through untouched, and anything else becomes `Code.Internal` with the original preserved as `cause` — logged, never sent on the wire.

| HTTP     | Connect code         | HTTP     | Connect code        |
| -------- | -------------------- | -------- | ------------------- |
| 400, 422 | `InvalidArgument`    | 429, 413 | `ResourceExhausted` |
| 401      | `Unauthenticated`    | 500      | `Internal`          |
| 403      | `PermissionDenied`   | 501, 405 | `Unimplemented`     |
| 404      | `NotFound`           | 503      | `Unavailable`       |
| 409      | `AlreadyExists`      | 504, 408 | `DeadlineExceeded`  |
| 412      | `FailedPrecondition` | 416      | `OutOfRange`        |

Rewrite anything else with `onError`:

```ts
GrpcAdapter({
  onError: (err, { service, method }) => {
    log.error({ err, service, method }, 'rpc failed')
    return new ConnectError('Service unavailable', Code.Unavailable)
  },
})
```

## Options

```ts
GrpcAdapter({
  prefix: '', // '' by default — see the warning above
  grpc: true, // binary gRPC (needs HTTP/2 in front)
  grpcWeb: true,
  connect: true,
  contributors: [], // applied to every RPC, at 'adapter' precedence
  routes: (router) => {}, // register services Connect-style, bypassing decorators
  readMaxBytes: undefined,
  writeMaxBytes: undefined,
  onError: undefined,
})
```

## Failures that abort boot

Deliberately loud, so they never surface as a request-time surprise:

- `@GrpcMethod('nope')` naming an RPC the descriptor doesn't declare — the error lists the RPCs that _are_ declared.
- A contributor dependency cycle, or a `dependsOn` key nothing produces.

## Introspection

```ts
import { GRPC_ADAPTER } from '@forinda/kickjs-grpc'

const grpc = container.resolve(GRPC_ADAPTER)
grpc.listServices() // ['user.v1.UserService']
grpc.getStats() // { services, methods, callsTotal, callsFailed, byMethod }
```

The adapter implements `introspect()`, so it also appears in the [DevTools](./devtools.md) topology view.
