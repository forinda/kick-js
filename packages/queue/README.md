# @forinda/kickjs-queue

Runs KickJS background jobs on BullMQ (default) or another broker through a provider — RabbitMQ, Kafka, Redis pub/sub, or your own. `@Job` / `@Process` live in `@forinda/kickjs` (re-exported here), so the same handlers also run on Cloudflare Queues or a runner you write — see the [Background Jobs guide](https://kickjs.app/guide/jobs).

## Install

```bash
# Default — BullMQ (Redis-backed jobs)
kick add queue

# Pick a specific provider — pulls in the right peer deps
kick add queue:bullmq         # Redis-backed durable jobs (default)
kick add queue:rabbitmq       # RabbitMQ via amqplib
kick add queue:kafka          # KafkaJS-backed event streaming
kick add queue:redis-pubsub   # lightweight pub/sub without persistence
```

## Quick Example

```ts
// processors/email.processor.ts
import { Job, Process } from '@forinda/kickjs'
import type { Job as BullMQJob } from 'bullmq'

@Job('email')
export class EmailProcessor {
  @Process('send-welcome')
  async sendWelcome(job: BullMQJob<{ email: string }>) {
    // ... send email
  }
}
```

```ts
// src/index.ts
import { bootstrap, getEnv } from '@forinda/kickjs'
import { QueueAdapter } from '@forinda/kickjs-queue'
import { modules } from './modules'

export const app = await bootstrap({
  modules,
  adapters: [QueueAdapter({ redis: { host: getEnv('REDIS_HOST'), port: 6379 } })],
})
```

Dispatch jobs from any service via `JOB_DISPATCHER`, which doesn't name the backend (`QUEUE_MANAGER` still resolves the same `QueueService`):

```ts
import { Inject, JOB_DISPATCHER, Service, type JobDispatcher } from '@forinda/kickjs'

@Service()
class UserService {
  @Inject(JOB_DISPATCHER) private jobs!: JobDispatcher

  signup(email: string) {
    return this.jobs.dispatch('email', 'send-welcome', { email })
  }
}
```

Another broker — BullMQ isn't needed:

```ts
import { QueueAdapter, RabbitMQProvider } from '@forinda/kickjs-queue'

QueueAdapter({ provider: new RabbitMQProvider(process.env.AMQP_URL!) })
```

## Documentation

[kickjs.app/api/queue](https://kickjs.app/api/queue)

## License

MIT
