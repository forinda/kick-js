# Microservices

KickJS has no microservices module. A service is an ordinary KickJS app, and the pieces that connect services already ship as packages:

| Need                                   | Use                                                                        |
| -------------------------------------- | -------------------------------------------------------------------------- |
| Ask another service and wait           | [gRPC / Connect RPC](./grpc.md) — a server and a typed client              |
| Tell other services something happened | [Background jobs](./jobs.md) over Kafka, RabbitMQ or Redis                 |
| Know a service is healthy              | `/health/ready`, on a [management port](./deployment.md#a-management-port) |
| Follow one request across services     | `x-request-id` and `traceparent`, forwarded by `propagateCall`             |

This page builds a small shop out of three services to show how they fit together:

```
          HTTP                    gRPC
client ─────────▶  orders  ─────────────▶  users
                     │
                     │ job: orders/placed  (Kafka)
                     ▼
               notifications
```

- **orders** — the public HTTP API. Placing an order asks **users** who the customer is, then announces the order.
- **users** — internal. Answers gRPC only.
- **notifications** — a worker. Sends the email when an order is placed; nobody calls it.

## The contract

Services that call each other share a `.proto`. Keep it in a package every service depends on (in a workspace, `packages/contracts`), and generate code with [`buf`](https://buf.build) and `protoc-gen-es` as the [gRPC guide](./grpc.md#the-proto-stays-the-source-of-truth) shows:

```proto
// packages/contracts/proto/users/v1/users.proto
syntax = "proto3";
package shop.users.v1;

service UserService {
  rpc GetUser(GetUserRequest) returns (User);
}

message GetUserRequest { string id = 1; }
message User {
  string id = 1;
  string email = 2;
  string name = 3;
}
```

Events need a contract too. A TypeScript type in the same package is enough:

```ts
// packages/contracts/src/events.ts
export interface OrderPlaced {
  orderId: string
  userId: string
  email: string
  total: number
}
```

## users: a gRPC service

```ts
// services/users/src/modules/users/users.rpc.ts
import { Autowired } from '@forinda/kickjs'
import { GrpcMethod, GrpcService, type GrpcContext } from '@forinda/kickjs-grpc'
import { Code, ConnectError } from '@connectrpc/connect'
import { UserService, type GetUserRequest } from '@shop/contracts/users/v1/users_pb'
import { UsersRepository } from './users.repository'

@GrpcService(UserService)
export class UsersRpc {
  @Autowired() private users!: UsersRepository

  @GrpcMethod()
  async getUser(req: GetUserRequest, ctx: GrpcContext) {
    const user = await this.users.findById(req.id, { signal: ctx.signal })
    if (!user) throw new ConnectError(`user ${req.id} not found`, Code.NotFound)
    return user
  }
}
```

```ts
// services/users/src/index.ts
import './config'
import { bootstrap } from '@forinda/kickjs'
import { fastifyRuntime } from '@forinda/kickjs/fastify'
import { GrpcAdapter } from '@forinda/kickjs-grpc'
import { modules } from './modules'

export const app = await bootstrap({
  modules,
  runtime: fastifyRuntime(),
  adapters: [GrpcAdapter()],
  // Cleartext HTTP/2: reachable only inside the private network (or from a mesh sidecar).
  server: { http2: 'h2c' },
  management: { port: 9090 },
})
```

Native gRPC needs HTTP/2, so **users** runs on Fastify (or h3) with `http2`. `'h2c'` suits a private network or a service mesh whose sidecar handles TLS; clients then use an `http://` URL.

Across a network you don't trust, serve TLS instead — `server: { tls: { key, cert }, http2: true }` — and use an `https://` URL. The calling service has to trust that certificate: with a private CA, start it with `NODE_EXTRA_CA_CERTS=/certs/ca.pem`, or pass `nodeOptions: { ca }` to `createGrpcTransport`. See [Which protocols actually work](./grpc.md#which-protocols-actually-work).

## orders: calling users

Make a client once and register it in DI, like any other third-party client:

```ts
// services/orders/src/modules/orders/users.client.ts
import { createToken } from '@forinda/kickjs'
import { createClient, type Client } from '@connectrpc/connect'
import { createGrpcTransport } from '@connectrpc/connect-node'
import { propagateCall } from '@forinda/kickjs-grpc'
import { UserService } from '@shop/contracts/users/v1/users_pb'

export const USERS = createToken<Client<typeof UserService>>('orders/users-client')

export const createUsersClient = (baseUrl: string) =>
  createClient(
    UserService,
    createGrpcTransport({ baseUrl, interceptors: [propagateCall], defaultTimeoutMs: 2_000 }),
  )
```

```ts
// services/orders/src/modules/orders/orders.module.ts
import { defineModule, getEnv } from '@forinda/kickjs'
import { OrdersController } from './orders.controller'
import { USERS, createUsersClient } from './users.client'

export const OrdersModule = defineModule({
  name: 'OrdersModule',
  build: () => ({
    register(container) {
      container.registerFactory(USERS, () => createUsersClient(getEnv('USERS_URL')))
    },
    routes: () => ({ path: '/orders', controller: OrdersController }),
  }),
})
```

`propagateCall` sends the current request's `x-request-id` (and `traceparent`, when [`traceContext()`](./middleware.md#trace-context) runs) with every call, so the logs of both services carry the same id. Called from inside an RPC, it also cancels the outgoing call when the incoming one is cancelled or runs out of time.

`defaultTimeoutMs` gives each call a deadline. Without one, a slow **users** holds the order request open for as long as it takes.

## orders: announcing the order

The service injects the client and the job dispatcher. It doesn't know who handles `orders/placed`, or how many services do:

```ts
// services/orders/src/modules/orders/orders.service.ts
import { Autowired, Inject, JOB_DISPATCHER, Service, type JobDispatcher } from '@forinda/kickjs'
import { Code, ConnectError, type Client } from '@connectrpc/connect'
import type { UserService } from '@shop/contracts/users/v1/users_pb'
import type { OrderPlaced } from '@shop/contracts/events'
import { OrdersRepository } from './orders.repository'
import { USERS } from './users.client'

@Service()
export class OrdersService {
  @Inject(USERS) private users!: Client<typeof UserService>
  @Inject(JOB_DISPATCHER) private jobs!: JobDispatcher
  @Autowired() private orders!: OrdersRepository

  async place(userId: string, total: number) {
    const user = await this.users.getUser({ id: userId }).catch((err) => {
      if (ConnectError.from(err).code === Code.NotFound) return null
      throw err
    })
    if (!user) return null

    const order = await this.orders.create({ userId, total })
    await this.jobs.dispatch('orders', 'placed', {
      orderId: order.id,
      userId,
      email: user.email,
      total,
    } satisfies OrderPlaced)
    return order
  }
}
```

```ts
// services/orders/src/index.ts
import './config'
import { bootstrap, getEnv } from '@forinda/kickjs'
import { QueueAdapter, KafkaProvider } from '@forinda/kickjs-queue'
import { modules } from './modules'

export const app = await bootstrap({
  modules,
  // Orders has no @Job classes, so it only dispatches.
  adapters: [
    QueueAdapter({ provider: new KafkaProvider({ brokers: getEnv('KAFKA_BROKERS').split(',') }) }),
  ],
  management: { port: 9090 },
})
```

The dispatch happens after the order is saved. If the broker is down at that moment the order exists but nobody hears about it; when that matters, write the event to an outbox table in the same transaction as the order and dispatch from there.

## notifications: reacting

A worker is an app with no routes: modules, `@Job` classes, and the queue adapter.

```ts
// services/notifications/src/modules/orders/order-events.ts
import { Autowired, Job, Process, type JobLike } from '@forinda/kickjs'
import type { OrderPlaced } from '@shop/contracts/events'
import { Mailer } from '../mail/mailer'

@Job('orders')
export class OrderEvents {
  @Autowired() private mailer!: Mailer

  @Process('placed')
  async placed(job: JobLike<OrderPlaced>) {
    await this.mailer.send(job.data.email, 'order-confirmation', job.data)
  }
}
```

```ts
// services/notifications/src/index.ts
import './config'
import { bootstrap, getEnv } from '@forinda/kickjs'
import { QueueAdapter, KafkaProvider } from '@forinda/kickjs-queue'
import { modules } from './modules'

export const app = await bootstrap({
  modules,
  adapters: [
    QueueAdapter({
      provider: new KafkaProvider({
        brokers: getEnv('KAFKA_BROKERS').split(','),
        groupId: 'notifications',
      }),
    }),
  ],
  management: { port: 9090 },
})
```

`groupId` decides who receives an event. Every service that consumes `orders` with **its own** `groupId` gets its own copy, so adding an `analytics` service later doesn't change orders or notifications. Instances of one service share a `groupId`, so each event is handled once per service, not once per replica. Without a `groupId` the provider uses `kickjs-<queue>` for everyone, and services would take turns instead.

A handler that throws doesn't acknowledge the message, so Kafka delivers it again. Make handlers idempotent: the same event can arrive twice.

## Running it

```yaml
# docker-compose.yml
services:
  users:
    build: ./services/users
    ports: ['3001:3000'] # only to try it from the host; drop in production
    environment: { DATABASE_URL: postgres://... }
  orders:
    build: ./services/orders
    ports: ['3000:3000']
    environment:
      USERS_URL: http://users:3000
      KAFKA_BROKERS: kafka:9092
    depends_on: [users, kafka]
  notifications:
    build: ./services/notifications
    environment: { KAFKA_BROKERS: kafka:9092 }
    depends_on: [kafka]
  kafka:
    image: apache/kafka:3.9.0
```

Each service builds with `kick build` and the Dockerfile `kick new` creates ([Deployment](./deployment.md)). **orders** is the public API; **users** publishes `3001` only so you can try it from the host, and **notifications** has no port at all. Inside the network, **orders** reaches **users** at `users:3000`.

Check **users** without a gRPC client. The Connect protocol answers JSON on the same port; the port speaks only HTTP/2, so tell curl to use it:

```bash
curl --http2-prior-knowledge -X POST http://localhost:3001/shop.users.v1.UserService/GetUser \
  -H 'Content-Type: application/json' -d '{"id":"u_1"}'
```

## Health and shutdown

- **Probes** go to `management: { port: 9090 }` — `/health/live` and `/health/ready`. Readiness runs every adapter's check, so a worker that lost its broker drops out of rotation. With `http2: 'h2c'` this matters more: the public port speaks only HTTP/2, which HTTP/1.1 probes can't reach.
- **Shutdown** drains in-flight requests and RPCs, then stops the queue workers. Keep the platform's grace period above `preStopDelay` plus twice `shutdownTimeout` ([Deployment](./deployment.md)).

## Testing a service alone

Each service tests without the others. Register a stub client under the same token:

```ts
import { createTestApp } from '@forinda/kickjs-testing'
import { USERS } from '../src/modules/orders/users.client'

const app = await createTestApp({
  modules,
  overrides: [
    [USERS, { getUser: async ({ id }: { id: string }) => ({ id, email: 'a@b.c', name: 'A' }) }],
  ],
})
```

To test the gRPC side, start the app and call it with a Connect client, as in the [gRPC guide](./grpc.md#trying-it-without-a-client).

## Related

- [gRPC / Connect RPC](./grpc.md) — services, contributors, errors, streaming
- [Background jobs](./jobs.md) — `@Job`, providers, API and worker processes
- [HTTPS and HTTP/2](./http-runtimes.md#https-and-http-2) — `tls`, `http2`, `'h2c'`
- [Deployment](./deployment.md) — probes, management port, shutdown
