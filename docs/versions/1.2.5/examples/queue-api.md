# Queue Example

REST API with background job processors using `@Job` and `@Process` decorators.

## Features

- Email and report job processors
- CLI-generated notification module
- Swagger + DevTools
- Ready for BullMQ/RabbitMQ/Kafka (requires external service)

## Running

```bash
cd examples/queue-api
kick dev
```

## Job Processors

Jobs are defined with decorators and automatically wired when a `QueueAdapter` is configured:

```ts
@Job('email-queue')
class EmailJob {
  @Process()
  async handle(job) {
    // Send email...
  }
}
```

To add jobs from a controller or service, inject `QueueService`:

```ts
@Inject(QUEUE_MANAGER) private queue: QueueService
await this.queue.add('email-queue', 'welcome', { to: 'user@example.com' })
```

## Source

- [examples/queue-api/](https://github.com/forinda/kick-js/tree/main/examples/queue-api)
