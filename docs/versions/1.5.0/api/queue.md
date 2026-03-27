# @forinda/kickjs-queue

Background job processing for KickJS applications using [BullMQ](https://docs.bullmq.io/) and Redis.

## Installation

```bash
pnpm add @forinda/kickjs-queue bullmq ioredis
```

## Exports

### Decorators

| Decorator | Description |
|-----------|-------------|
| `@Job(queueName)` | Mark a class as a job processor for a named queue |
| `@Process(jobName?)` | Mark a method as the handler for a specific job (or default handler) |

### Adapter

| Export | Description |
|--------|-------------|
| `QueueAdapter` | AppAdapter that initializes BullMQ workers and queues |

### Service

| Export | Description |
|--------|-------------|
| `QueueService` | Injectable service for adding jobs and accessing queues |

### Types

| Export | Description |
|--------|-------------|
| `QueueAdapterOptions` | Configuration options for `QueueAdapter` |
| `JobMeta` | Metadata stored by `@Job` |
| `ProcessMeta` | Metadata stored by `@Process` |

## QueueAdapter Options

```ts
interface QueueAdapterOptions {
  /** Redis connection configuration */
  redis: { host: string; port: number; password?: string }
  /** Queue names to pre-create (optional — queues are also created on-demand via @Job) */
  queues?: string[]
  /** Number of concurrent jobs per worker (default: 1) */
  concurrency?: number
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `redis` | `{ host, port, password? }` | — | Redis connection configuration |
| `queues` | `string[]` | `[]` | Queue names to pre-create. Queues referenced by `@Job` are created automatically even if not listed here. |
| `concurrency` | `number` | `1` | Number of concurrent jobs each worker processes |

::: warning
Pass queue **name strings** (e.g. `['email', 'notifications']`), not class references. Passing classes causes a runtime error in BullMQ. Processor classes are discovered automatically via the `@Job` decorator — you do not need to list them here.
:::

## Decorators

### @Job

Marks a class as a job processor bound to a named queue. Each `@Job` class becomes a BullMQ worker.

```ts
@Job('email')
export class EmailProcessor { ... }
```

### @Process

Marks a method as the handler for a specific job name within the queue. Without an argument, it becomes the default handler for all jobs in that queue.

```ts
@Process()
async handleDefault(job: BullMQJob) { ... }

@Process('welcome')
async handleWelcome(job: BullMQJob) { ... }
```

## QueueService

The `QueueService` is automatically registered in the DI container when `QueueAdapter` is used. Inject it into any service or controller.

### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `add` | `add(queueName: string, jobName: string, data: any, opts?: JobsOptions): Promise<Job>` | Add a single job to a queue |
| `addBulk` | `addBulk(queueName: string, jobs: { name: string; data: any; opts?: JobsOptions }[]): Promise<Job[]>` | Add multiple jobs to a queue in one call |
| `getQueue` | `getQueue(queueName: string): Queue` | Get the raw BullMQ Queue instance for advanced operations |

### Usage

```ts
import { Service, Autowired } from '@forinda/kickjs-core'
import { QueueService } from '@forinda/kickjs-queue'

@Service()
export class UserService {
  @Autowired()
  private queueService!: QueueService

  async createUser(data: CreateUserDto) {
    const user = await this.userRepo.create(data)

    // Enqueue a welcome email job
    await this.queueService.add('email', 'welcome', {
      to: user.email,
      name: user.name,
    })

    return user
  }
}
```

## Example

### Job Processor

```ts
import { Job, Process } from '@forinda/kickjs-queue'
import { Service, Autowired } from '@forinda/kickjs-core'

@Service()
@Job('email')
export class EmailProcessor {
  @Autowired()
  private mailer!: MailService

  @Process('welcome')
  async sendWelcome(job: BullMQJob<{ to: string; name: string }>) {
    await this.mailer.send({
      to: job.data.to,
      subject: `Welcome, ${job.data.name}!`,
      template: 'welcome',
    })
  }

  @Process('reset-password')
  async sendResetPassword(job: BullMQJob<{ to: string; token: string }>) {
    await this.mailer.send({
      to: job.data.to,
      subject: 'Password Reset',
      template: 'reset-password',
      data: { token: job.data.token },
    })
  }
}
```

### Bootstrap

```ts
import { bootstrap } from '@forinda/kickjs-core'
import { QueueAdapter } from '@forinda/kickjs-queue'
import { EmailProcessor } from './jobs/email.processor'

bootstrap({
  modules,
  adapters: [
    new QueueAdapter({
      redis: {
        host: 'localhost',
        port: 6379,
      },
      queues: [EmailProcessor],
      concurrency: 5,
    }),
  ],
})
```

## Related

- [Adapters Guide](../guide/adapters.md) -- how adapters hook into the KickJS lifecycle
- [@forinda/kickjs-core](./core.md) -- DI container, decorators
