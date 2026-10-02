---
'@forinda/kickjs-devtools-kit': minor
'@forinda/kickjs-queue': minor
---

Manage jobs from DevTools.

- **`JobInspector`** (devtools-kit): the contract the DevTools Queues tab uses to list queues, page through jobs by state, read one job, and — when implemented — retry, remove, retry all failed, clean a state, and pause / resume. Any job tool can implement it; an adapter or plugin exposes it as `jobInspector()`.
- **`QueueAdapter`** implements it for BullMQ. Providers with no job store (RabbitMQ, Kafka, Redis pub/sub) list their queues without jobs.
- **The queue package's own DevTools panel is gone:** the built-in Queues tab replaces the iframe tab and its `/_kick/queue/panel` and `/_kick/queue/data` routes (the data route carried no auth). The `panel` option is deprecated and has no effect.
