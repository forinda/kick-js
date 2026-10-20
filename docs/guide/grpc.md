# gRPC / Connect RPC

`@forinda/kickjs-grpc` serves **gRPC, gRPC-Web, and the Connect protocol from the same app and the same port** as your HTTP routes. It is built on [Connect RPC](https://connectrpc.com), so one handler answers all three protocols.

Services are ordinary KickJS classes with full DI and the same Context Contributor pipeline your HTTP routes use.

<PmCommand add="@forinda/kickjs-grpc @connectrpc/connect @connectrpc/connect-node @bufbuild/protobuf" />

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

The adapter mounts as middleware on the KickJS server, so what reaches you depends on the server `start()` creates:

| Protocol        | HTTP/1.1 (default) | `server: { tls, http2: true }` | Notes                                |
| --------------- | ------------------ | ------------------------------ | ------------------------------------ |
| **Connect**     | ✅                 | ✅                             | JSON or binary over HTTP. Curl-able. |
| **gRPC-Web**    | ✅                 | ✅                             | What browsers use. No proxy needed.  |
| **native gRPC** | ❌                 | ✅ (Fastify, h3)               | Needs HTTP/2 **and** HTTP trailers.  |

To serve native gRPC clients from the app itself, run on Fastify or h3 and turn on HTTP/2 (Express can't serve HTTP/2):

```ts
import { readFileSync } from 'node:fs'
import { bootstrap } from '@forinda/kickjs'
import { fastifyRuntime } from '@forinda/kickjs/fastify'
import { GrpcAdapter } from '@forinda/kickjs-grpc'

bootstrap({
  modules,
  runtime: fastifyRuntime(),
  adapters: [GrpcAdapter()],
  server: {
    tls: { key: readFileSync('key.pem'), cert: readFileSync('cert.pem') },
    http2: true,
  },
})
```

gRPC clients negotiate HTTP/2; browsers, curl and Connect clients on HTTP/1.1 still reach the same port. See [HTTPS and HTTP/2](./http-runtimes.md#https-and-http-2) for the `server` option.

Behind a service mesh whose sidecar handles TLS and speaks cleartext HTTP/2 to the app (Envoy, Linkerd, Istio), use `server: { http2: 'h2c' }` instead and drop the certificate.

A proxy or ingress in front (Envoy, nginx, Cloud Run) doesn't lift the requirement: native gRPC needs HTTP/2 on every hop, so the proxy's connection to the app has to be HTTP/2 too — `h2c` or TLS, set in the proxy's upstream config. A proxy that forwards over HTTP/1.1 breaks native gRPC. On Express, which can't serve HTTP/2, offer Connect or gRPC-Web instead. RPC paths are identical on every protocol, so service code does not change.

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
import { UserService, type GetUserRequest } from '../gen/user/v1/user_pb'
import { UserRepository } from './user.repository'

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

Contributors written with `defineContextDecorator` work on RPCs unchanged — same `dependsOn` topo-sort, same boot-time cycle detection.

::: warning Three of the five registration sites apply
The framework's full precedence chain is **method > class > module > adapter > global**. RPCs participate in three of those: **method > class > adapter**.

The `module` and `global` levels are HTTP-only by construction — `AppModule.contributors()` is merged when a module mounts its **routes**, and `bootstrap({ contributors })` feeds the HTTP route table. Neither reaches a non-HTTP transport. To cover every RPC, register through `GrpcAdapter({ contributors })` instead.
:::

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

Throw what you already throw. `HttpException` maps by status and its message **is** sent — raising one is a deliberate act of describing a fault to the caller. A `ConnectError` passes through untouched.

::: danger Unexpected errors are redacted
Anything else — a plain `Error`, a `MissingContextValueError`, a non-`Error` throw — becomes `Code.Internal` with the opaque message `"Internal error"`. The original **never reaches the client**: `err.message` routinely carries SQL fragments, absolute paths, connection strings, and upstream hostnames, and an unexpected fault is not something the caller can act on anyway.

It is not lost, though — the adapter logs it server-side at `error` level with the RPC name, and it stays on `ConnectError.cause`. To put a real message on the wire, say so explicitly: throw a `ConnectError` or an `HttpException`, or map it through `onError`.
:::

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
    // The adapter already logs Code.Internal failures — add this only for
    // your own reporting (Sentry, metrics, an audit trail).
    reportToSentry(err, { service, method })
    return new ConnectError('Service unavailable', Code.Unavailable)
  },
})
```

## Calling other services

Clients come from Connect itself: `createClient` with a transport. Add `propagateCall` to its interceptors when the client is used while serving a request or an RPC:

```ts
import { createClient } from '@connectrpc/connect'
import { createGrpcTransport } from '@connectrpc/connect-node'
import { propagateCall } from '@forinda/kickjs-grpc'
import { UserService } from './gen/user_pb'

const users = createClient(
  UserService,
  createGrpcTransport({ baseUrl: 'https://users:3000', interceptors: [propagateCall] }),
)
```

Every call then carries the current request's `x-request-id`, and `traceparent` when [`traceContext()`](./middleware.md#trace-context) ran. Inside an RPC, the outgoing call is cancelled when the incoming one is — the caller hung up or its deadline passed — so the services downstream stop working for it too. Headers set on the call win; outside a request the interceptor does nothing.

Register the client in DI like any third-party client (`container.registerFactory(USERS, () => createClient(...))`). [Microservices](./microservices.md) puts it together across three services.

## Options

```ts
GrpcAdapter({
  prefix: '', // '' by default — see the warning above
  grpc: true, // native gRPC (needs HTTP/2 — see above)
  grpcWeb: true,
  connect: true,
  contributors: [], // every RPC, at 'adapter' precedence (see above)
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

The adapter implements `introspect()`, so it also appears in the **Plugged in** list on the [DevTools](./devtools.md) Runtime tab.
