# @forinda/kickjs-queue

BullMQ queue/worker adapter with decorator-driven job processing for KickJS.

## Install

```bash
# Using the KickJS CLI (recommended — auto-installs peer dependencies)
kick add queue:bullmq     # BullMQ + Redis
kick add queue:rabbitmq   # RabbitMQ
kick add queue:kafka      # Kafka

# Manual install (BullMQ example)
pnpm add @forinda/kickjs-queue bullmq ioredis
```

## Features

- `QueueAdapter` — lifecycle adapter that connects queues and workers
- `QueueService` — injectable service for dispatching jobs
- Decorators: `@Job` (define job types), `@Process` (handle jobs)
- Built-in providers: `BullMQProvider`, `RabbitMQProvider`, `KafkaProvider`, `RedisPubSubProvider`
- `QUEUE_MANAGER` token for DI injection

## Quick Example

```typescript
import { QueueAdapter, QueueService, Job, Process } from '@forinda/kickjs-queue'
import { Service, Inject } from '@forinda/kickjs-core'

@Service()
class EmailProcessor {
  @Process('send-email')
  async handle(job: { to: string; subject: string; html: string }) {
    console.log(`Sending email to ${job.to}`)
  }
}

// Dispatch a job from any service
@Service()
class UserService {
  @Inject(QUEUE_MANAGER) private queue!: QueueService

  async createUser(data: CreateUserDTO) {
    const user = await this.repo.create(data)
    await this.queue.add('send-email', {
      to: user.email,
      subject: 'Welcome!',
      html: '<h1>Welcome</h1>',
    })
    return user
  }
}

bootstrap({
  modules,
  adapters: [
    new QueueAdapter({
      connection: { host: 'localhost', port: 6379 },
    }),
  ],
})
```

## Documentation

[Full documentation](https://forinda.github.io/kick-js/)

## License

MIT
