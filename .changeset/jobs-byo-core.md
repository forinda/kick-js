---
'@forinda/kickjs': minor
---

Background jobs with any runner. `@Job(queue)` / `@Process(name)` now live in `@forinda/kickjs` and only record which method handles which job, the same way `@Cron` records a schedule. Any job tool runs them with two calls:

- **`listJobQueues(container)` / `listJobHandlers(container)`** — what to subscribe to.
- **`runJob(container, queue, job, extra?)`** — picks the `@Process` method for `job.name` (or the queue's catch-all) and calls it with the runner's own job object. A failure is reported to the error observers with `source: 'job'` and rethrown, so the runner's retries still apply. A job nothing handles throws `NoJobHandlerError` instead of being acknowledged.

**Enqueue without naming the tool:** inject `JOB_DISPATCHER` and call `dispatch(queue, name, data, options)`. The active adapter provides it.

**Cloudflare Queues:** `createFetchHandler()` returns `queue()` beside `fetch` and `scheduled`. Each message runs through `runJob` and is acked on success or retried on failure.
