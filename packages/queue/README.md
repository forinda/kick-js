# @forinda/kickjs-queue

Decorator-driven job processing for KickJS — `@Job` to declare a queue class, `@Process` to bind handlers, `QueueService` for dispatch. Pluggable providers: BullMQ (default), RabbitMQ, Kafka, and Redis pub/sub.

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
import { Service } from '@forinda/kickjs'
import { Job, Process } from '@forinda/kickjs-queue'
import type { Job as BullMQJob } from 'bullmq'

@Service()
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

Dispatch jobs from any service via the injected `QUEUE_MANAGER`:

```ts
import { Inject, Service } from '@forinda/kickjs'
import { QUEUE_MANAGER, type QueueService } from '@forinda/kickjs-queue'

@Service()
class UserService {
  constructor(@Inject(QUEUE_MANAGER) private queue: QueueService) {}

  signup(email: string) {
    return this.queue.add('email', 'send-welcome', { email })
  }
}
```

## Documentation

[kickjs.app/api/queue](https://kickjs.app/api/queue)

## License

MIT
