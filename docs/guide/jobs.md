# Background Jobs

`@Job` and `@Process` mark the methods that handle background jobs. What runs them depends on where the app is deployed — the same way [`@Cron`](./cron.md) works:

| Where                       | What runs the jobs                                                            |
| --------------------------- | ----------------------------------------------------------------------------- |
| Node server, Redis          | `QueueAdapter({ redis })` from `@forinda/kickjs-queue` (BullMQ)               |
| Node server, another broker | `QueueAdapter({ provider })` — RabbitMQ, Kafka, Redis pub/sub, or your own    |
| Cloudflare Workers          | the web entry's `queue()` handler (Cloudflare Queues)                         |
| Any other tool              | a few lines of your own — see [Bring your own runner](#bring-your-own-runner) |

## Declare handlers

```ts
import { Job, Process, type JobLike } from '@forinda/kickjs'

@Job('email')
export class EmailJobs {
  @Process('welcome')
  async welcome(job: JobLike<{ to: string }>) {
    await this.mailer.sendWelcome(job.data.to)
  }

  // No name: every other job on the `email` queue.
  @Process()
  async other(job: JobLike) {
    this.log.warn(`Unhandled email job ${job.name}`)
  }
}
```

The class is a DI singleton, so handlers get the same services requests do. A handler receives the runner's own job object — with BullMQ that's BullMQ's `Job`, so `job.attemptsMade` and `job.updateProgress()` are still there. `JobLike` (`name`, `data`, `id`) is what every runner provides.

A job that fails is reported to the [error observers](./observability.md) with `source: 'job'` and rethrown, so the runner's retries and dead-letter handling still apply. A job no `@Process` method handles fails with `NoJobHandlerError` instead of being acknowledged and lost.

## Enqueue

Inject the dispatcher — the code doesn't name the tool, so switching runners doesn't touch it:

```ts
import { Inject, JOB_DISPATCHER, Service, type JobDispatcher } from '@forinda/kickjs'

@Service()
export class SignupService {
  @Inject(JOB_DISPATCHER) private jobs!: JobDispatcher

  async signup(email: string) {
    await this.jobs.dispatch('email', 'welcome', { to: email })
  }
}
```

The fourth argument is passed to the runner as-is — BullMQ job options such as `{ delay: 5000, attempts: 3 }`.

## Node server

<PmCommand add="@forinda/kickjs-queue bullmq ioredis" />

```ts
import { QueueAdapter } from '@forinda/kickjs-queue'

export const app = await bootstrap({
  modules,
  adapters: [QueueAdapter({ redis: { host: '127.0.0.1', port: 6379 }, concurrency: 5 })],
})
```

Another broker — the adapter subscribes to every queue a `@Job` class handles and dispatches through the provider; BullMQ needn't be installed:

```ts
import { QueueAdapter, RabbitMQProvider } from '@forinda/kickjs-queue'

QueueAdapter({ provider: new RabbitMQProvider(process.env.AMQP_URL!) })
```

A provider implements `QueueProvider`: `addJob`, `createWorker(queue, processor, concurrency)` and `shutdown`, plus optional `addBulk` / `getQueue`.

## Cloudflare Workers

`createFetchHandler` returns `queue()` beside `fetch` and `scheduled`. Each message in a batch goes to the `@Job` class for the batch's queue, and is acked when its handler succeeds or retried when it throws:

```ts
export default createFetchHandler((env) => ({ h3, modules, env }))
```

```toml
[[queues.consumers]]
queue = "email"
```

Send messages as `{ name, data }` to reach `@Process(name)`; any other body goes to the queue's catch-all `@Process()` as `data`. Producing is the Workers binding itself — `env.EMAIL.send({ name: 'welcome', data: { to } })`.

## Bring your own runner

Any job tool needs two things: the queues to subscribe to, and a function to call per job.

```ts
import PgBoss from 'pg-boss'
import {
  JOB_DISPATCHER,
  defineAdapter,
  listJobQueues,
  runJob,
  type JobDispatcher,
} from '@forinda/kickjs'

export const PgBossAdapter = defineAdapter<{ url: string }>({
  name: 'PgBossAdapter',
  build: ({ url }) => {
    const boss = new PgBoss(url)
    return {
      async beforeStart({ container }) {
        await boss.start()
        for (const queue of listJobQueues(container)) {
          await boss.createQueue(queue)
          await boss.work(queue, async ([job]) =>
            runJob(container, queue, { name: job.data.name, data: job.data.data, id: job.id }),
          )
        }
        const dispatcher: JobDispatcher = {
          dispatch: (queue, name, data, options) => boss.send(queue, { name, data }, options),
        }
        container.registerFactory(JOB_DISPATCHER, () => dispatcher)
      },
      async shutdown() {
        await boss.stop()
      },
    }
  },
})
```

`runJob(container, queue, job, extra?)` picks the handler, runs it, reports a failure (with `extra` added to the report's context — an attempt count, say) and rethrows. `listJobHandlers(container)` returns every handler with its queue, job name, class and method, for tools that subscribe per job name.

## In DevTools

The DevTools **Queues** tab lists each queue's jobs by state, shows a job's data, error and attempts, and retries, removes or cleans jobs — for BullMQ through `QueueAdapter`, and for your own runner once its adapter returns a `JobInspector` from `jobInspector()`. See [DevTools → Job management](./devtools.md#job-management).

## Related

- [Scheduled Tasks](./cron.md)
- [Observing Errors and Responses](./observability.md)
- [Serverless](./serverless.md)
