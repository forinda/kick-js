# @forinda/kickjs-queue

BullMQ adapter with decorator-driven job processing for KickJS — `@Job` to declare a queue class, `@Process` to bind handlers, `QueueService` for dispatch.

## Install

```bash
kick add queue
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

[forinda.github.io/kick-js/api/queue](https://forinda.github.io/kick-js/api/queue)

## License

MIT
