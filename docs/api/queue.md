# @forinda/kickjs-queue

Background job runner for KickJS: [BullMQ](https://docs.bullmq.io/) on Redis by default, or RabbitMQ, Kafka, Redis pub/sub or your own backend through a `QueueProvider`. It runs the `@Job` / `@Process` handlers declared with `@forinda/kickjs` — see the [Background Jobs guide](../guide/jobs.md) for the full walkthrough.

## Installation

<PmCommand add="@forinda/kickjs-queue bullmq ioredis" />

`bullmq` and `ioredis` are optional peers, needed only for the built-in BullMQ runner (the `redis` option). Other providers need their own client: `amqplib` (RabbitMQ), `kafkajs` (Kafka), `ioredis` (Redis pub/sub).

## Exports

| Export                | Description                                                          |
| --------------------- | -------------------------------------------------------------------- |
| `QueueAdapter`        | Adapter that creates queues and starts a worker per handled queue    |
| `QueueService`        | Adds jobs; registered under `QUEUE_MANAGER` and `JOB_DISPATCHER`     |
| `QUEUE_MANAGER`       | DI token for the `QueueService`                                      |
| `Job`, `Process`      | Re-exported from `@forinda/kickjs`, so existing imports keep working |
| `BullMQProvider`      | `QueueProvider` over BullMQ                                          |
| `RabbitMQProvider`    | `QueueProvider` over AMQP (`amqplib`)                                |
| `KafkaProvider`       | `QueueProvider` over KafkaJS                                         |
| `RedisPubSubProvider` | `QueueProvider` over Redis pub/sub (no job store, no retries)        |

Types: `QueueAdapterOptions`, `QueueProvider`, `BulkJobEntry`.

`@forinda/kickjs-queue/testing` exports `MemoryQueueProvider`, an in-process provider for tests — see [Testing](../guide/jobs.md#testing).

## QueueAdapter

```ts
type QueueAdapterOptions = {
  queues?: string[] // queue names to pre-create
  concurrency?: number // worker concurrency, default 1
  workers?: boolean // false: dispatch only, start no workers
} & (
  | { redis: { host: string; port: number; password?: string }; provider?: undefined }
  | { provider: QueueProvider; redis?: undefined }
)
```

| Option        | Type                        | Default | Description                                                                            |
| ------------- | --------------------------- | ------- | -------------------------------------------------------------------------------------- |
| `redis`       | `{ host, port, password? }` | —       | Connection for the built-in BullMQ runner. Give this **or** `provider`                 |
| `provider`    | `QueueProvider`             | —       | Any other backend                                                                      |
| `queues`      | `string[]`                  | `[]`    | Queue names to pre-create. Queues that have a `@Job` handler are created automatically |
| `concurrency` | `number`                    | `1`     | Jobs each worker processes at once                                                     |
| `workers`     | `boolean`                   | `true`  | `false` starts no workers — an API process that only dispatches                        |
| `panel`       | `boolean`                   | —       | Deprecated, no effect — queues show in the DevTools **Queues** tab                     |

At `beforeStart` the adapter finds every resolvable `@Job` class, creates its queue, and starts one worker per handled queue. With BullMQ the handler receives BullMQ's own `Job`, so `job.attemptsMade` and `job.updateProgress()` work. Failed jobs are logged and reported to error observers with `source: 'job'`, then rethrown so the runner's retries apply. A handler's return value is kept: BullMQ stores it as `job.returnvalue`, and a provider's `processor` resolves with it.

`onHealthCheck()` feeds `/health/ready`: a Redis PING behind each queue, or the provider's `ping()`.

::: warning
Pass queue **name strings** (e.g. `['email', 'notifications']`), not class references. Processor classes are discovered from `@Job`; you don't list them.
:::

```ts
import { bootstrap } from '@forinda/kickjs'
import { QueueAdapter, RabbitMQProvider } from '@forinda/kickjs-queue'

bootstrap({
  modules,
  adapters: [
    QueueAdapter({ redis: { host: 'localhost', port: 6379 }, concurrency: 5 }),
    // or: QueueAdapter({ provider: new RabbitMQProvider('amqp://localhost') }),
  ],
})
```

## Declaring handlers

```ts
import { Job, Process, type JobLike } from '@forinda/kickjs'

@Job('email')
export class EmailJobs {
  @Process('welcome')
  async welcome(job: JobLike<{ to: string }>) {
    /* ... */
  }

  @Process() // every other job on the `email` queue
  async other(job: JobLike) {}
}
```

## QueueService

Not registered by class — inject it with `@Inject(QUEUE_MANAGER)`, or prefer the backend-neutral `@Inject(JOB_DISPATCHER)` from `@forinda/kickjs`.

| Method          | Signature                                                            | Description                                                     |
| --------------- | -------------------------------------------------------------------- | --------------------------------------------------------------- |
| `add`           | `add(queue: string, jobName: string, data: any, opts?: JobsOptions)` | Add one job. Throws when the queue isn't registered (BullMQ)    |
| `addBulk`       | `addBulk(queue: string, jobs: BulkJobEntry[])`                       | Add several jobs (`{ name, data, opts? }`)                      |
| `dispatch`      | `dispatch(queue, name, data, options?): Promise<unknown>`            | `JobDispatcher`: `add` with the caller's job context stamped on |
| `getQueue`      | `getQueue(name: string): Queue \| undefined`                         | Raw BullMQ `Queue` (provider mode: see below)                   |
| `getQueueNames` | `getQueueNames(): string[]`                                          | Registered queue names                                          |
| `closeAll`      | `closeAll(): Promise<void>`                                          | Close every queue                                               |

With a `provider`, `add` / `addBulk` go through it (`addBulk` falls back to one `addJob` per entry). `getQueue` then returns whatever `provider.getQueue(name)` gives (or a bare `{ name }`), typed as `Queue` but not a BullMQ instance unless the provider is — don't call BullMQ methods on it.

```ts
import { Inject, JOB_DISPATCHER, Service, type JobDispatcher } from '@forinda/kickjs'

@Service()
export class SignupService {
  @Inject(JOB_DISPATCHER) private jobs!: JobDispatcher

  async signup(email: string) {
    await this.jobs.dispatch('email', 'welcome', { to: email }, { attempts: 3 })
  }
}
```

## Providers

```ts
new BullMQProvider(redis: { host: string; port: number; password?: string }, defaultConcurrency = 1)
new RabbitMQProvider(url: string)
new KafkaProvider({ brokers: string[]; clientId?: string; groupId?: string })
new RedisPubSubProvider(redis: { host: string; port: number; password?: string })
```

Implement `QueueProvider` for any other backend:

```ts
interface QueueProvider {
  addJob(queue: string, name: string, data: any, opts?: any): Promise<any>
  addBulk?(queue: string, jobs: Array<{ name: string; data: any; opts?: any }>): Promise<any[]>
  createWorker(
    queue: string,
    processor: (job: { name: string; data: any; id?: string }) => Promise<unknown>, // resolves with the handler's return value
    concurrency?: number,
  ): any
  getQueue?(name: string): any
  ping?(): Promise<unknown> // reject when the backend is unreachable — used by /health/ready
  shutdown(): Promise<void>
}
```

Only BullMQ queues expose job listing, retry and removal in the DevTools Queues tab; other providers show their queues without counts.

## Related

- [Background Jobs guide](../guide/jobs.md) and [tutorial](../guide/tutorial-background-jobs.md)
- [Adapters guide](../guide/adapters.md) — how adapters hook into the lifecycle
- [@forinda/kickjs — core](./core.md) — `@Job`, `@Process`, `JOB_DISPATCHER`
- [@forinda/kickjs-di](./di.md) — the DI container
