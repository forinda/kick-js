---
'@forinda/kickjs-queue': minor
---

`@forinda/kickjs-queue/testing` exports `MemoryQueueProvider`, an in-process provider for tests that runs `@Process` handlers with `attempts`, `backoff`, `delay`, `job.updateProgress()` and the handler's return value. `QueueAdapter` gains `workers: false` (dispatch only — for an API process whose jobs run elsewhere) and an `onHealthCheck()` for `/health/ready` (a Redis PING per queue, or the provider's new optional `ping()`; `BullMQProvider` implements it). With a `provider`, the job handler's return value is no longer dropped: the `processor` given to `createWorker` now resolves with it (`Promise<unknown>`, was `Promise<void>`).
