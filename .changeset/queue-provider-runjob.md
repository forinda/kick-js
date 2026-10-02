---
'@forinda/kickjs-queue': major
---

`QueueAdapter({ provider })` works, and every job runs through `@forinda/kickjs`'s `runJob`.

- **Providers work.** `QueueAdapter({ provider: new RabbitMQProvider(url) })` (or Kafka, Redis pub/sub, your own `QueueProvider`) subscribes each queue a `@Job` class handles and dispatches through the provider. Before, the adapter ignored `provider` and always built BullMQ queues. BullMQ is now loaded only for `redis`, so `bullmq` / `ioredis` are optional peers.
- **`@Job` / `@Process` come from `@forinda/kickjs`.** They are re-exported here, so existing imports keep working, and the metadata keys are unchanged.
- **`QueueService` is also `JOB_DISPATCHER`**, with a `dispatch()` method. `QUEUE_MANAGER` still resolves it.
- **Handlers still receive the BullMQ `Job` itself** on the Redis path, so `attemptsMade` and `updateProgress()` are still there.

**Breaking:**

- A job no `@Process` method handles now fails (`NoJobHandlerError`) instead of completing with a warning.
- The peer range is now `@forinda/kickjs >= 8.8.0`.
- `QueueAdapterOptions` is a union: either `redis` or `provider`.
- The internal `jobRegistry` export is gone; use `listJobHandlers(container)`.
- `beforeStart` is async.
