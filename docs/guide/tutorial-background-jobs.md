# Background Jobs and Scheduled Tasks in Node.js

_Part 5 of "Building a Task Management App with KickJS"_

---

::: info Updated for current packages
The original build used `@forinda/kickjs-mailer` and `@forinda/kickjs-cron`, both removed since. The samples below use their replacements: `@Cron` and `KickCronAdapter()` from `@forinda/kickjs` ([Scheduled Tasks](./cron.md)), and a `MailerService` you register yourself ([Mailers](./mailer.md)). Queue handlers and dispatch are covered in full in [Background Jobs](./jobs.md).
:::

Vibed sends emails, creates notification records, logs activity, and runs scheduled cleanup — all outside the HTTP request cycle. This article covers how we structured background jobs with BullMQ and scheduled tasks with cron, and the patterns that keep them maintainable.

## Why Background Jobs?

When a user creates a comment with `@mentions`, the HTTP response should return immediately. But behind the scenes, we need to:

1. Create a notification record for each mentioned user
2. Send an email to each mentioned user
3. Log an activity entry for the workspace feed

If we did all of this synchronously in the use case, the API response would be slow and brittle — an email API timeout would fail the entire comment creation.

Instead, we dispatch jobs to a queue. A separate worker process picks them up asynchronously.

## The Architecture

```
HTTP Request → Use Case → Queue (Redis/BullMQ) → Processor → Side Effect
                                                      ↓
                                                 Email / DB / External API
```

Three queue processors handle different concerns:

| Queue           | Processor             | Jobs                                                                                                                    |
| --------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `email`         | EmailProcessor        | send-welcome-email, send-task-assigned, send-mentioned, send-overdue-reminder, send-workspace-invite, send-daily-digest |
| `notifications` | NotificationProcessor | create-notification                                                                                                     |
| `activity`      | ActivityProcessor     | log-activity                                                                                                            |

## Queue Processor Pattern

Each processor is a class decorated with `@Job(queueName)` — which also registers it as a DI singleton, so no `@Service()` is needed. Individual methods are decorated with `@Process(jobName)`:

```typescript
import { Autowired, Job, Process } from '@forinda/kickjs'
import type { Job as BullMQJob } from 'bullmq'
import { MailerService } from '@/services/mailer.service'

@Job('email')
export class EmailProcessor {
  @Autowired() private mailer!: MailerService

  @Process('send-welcome-email')
  async sendWelcome(job: BullMQJob<{ email: string; firstName: string }>) {
    await this.mailer.send({
      to: job.data.email,
      subject: `Welcome to Vibed, ${job.data.firstName}!`,
      html: `<h1>Welcome!</h1><p>Hi ${job.data.firstName}, your account is ready.</p>`,
    })
  }

  @Process('send-task-assigned')
  async sendTaskAssigned(
    job: BullMQJob<{ email: string; taskKey: string; taskTitle: string; assignerName: string }>,
  ) {
    await this.mailer.send({
      to: job.data.email,
      subject: `You were assigned to ${job.data.taskKey}: ${job.data.taskTitle}`,
      html: `<p>${job.data.assignerName} assigned you to <strong>${job.data.taskKey}</strong></p>`,
    })
  }
}
```

`@Autowired()` injects the mailer service — a real provider in production, or a console mailer in development that logs emails to stdout instead of sending them (see [Email Provider Strategy](#email-provider-strategy)).

## Dispatching Jobs

Use cases dispatch jobs through the `JOB_DISPATCHER` token, which `QueueAdapter` binds — the code never names BullMQ:

```typescript
import { Inject, JOB_DISPATCHER, type JobDispatcher } from '@forinda/kickjs'

// In a use case constructor
@Inject(JOB_DISPATCHER) private jobs: JobDispatcher

// Dispatching
await this.jobs.dispatch('email', 'send-welcome-email', {
  email: user.email,
  firstName: user.firstName,
})

await this.jobs.dispatch('notifications', 'create-notification', {
  recipientId: mentionedUserId,
  type: 'mentioned',
  title: `You were mentioned in ${task.key}`,
  body: `${commenter.email} mentioned you in a comment`,
  metadata: { taskId: task.id, commentId: comment.id },
})
```

Jobs are typed via the `BullMQJob<T>` generic on the processor method — but there's no compile-time check between dispatch and consumption. This is a trade-off of queue-based architectures.

## Queue Module: The No-Routes Module

The queue module has no HTTP endpoints. It exists only to load the processor and cron classes:

```typescript
import { defineModule } from '@forinda/kickjs'

// Eagerly load every file so @Job / @Process / @Cron classes register
import.meta.glob(['./**/*.ts', '!./**/*.test.ts', '!./**/*.d.ts'], { eager: true })

export const QueueModule = defineModule({
  name: 'QueueModule',
  build: () => ({
    routes: () => null, // No HTTP routes — and no register(): @Job classes register themselves
  }),
})
```

The `import.meta.glob` eagerly loads processor files so `@Job()` and `@Process()` decorators register before the queue adapter starts consuming.

## Cron Jobs

Scheduled tasks use `@Cron` from `@forinda/kickjs`. Like queue processors, the cron classes are `@Service()`s loaded by a module (the queue module's glob picks them up); one `KickCronAdapter()` schedules every `@Cron` method it finds:

<PmCommand add="croner" />

```typescript
// src/config/adapters.ts
import { KickCronAdapter } from '@forinda/kickjs'

KickCronAdapter()
```

### Overdue Task Reminders (Daily at 9am)

The most complex cron job queries for overdue tasks, looks up each task's assignees, and dispatches email jobs. The data access lives behind the task repository — the cron job just calls repository methods:

```typescript
@Service()
export class TaskCronJobs {
  constructor(
    @Inject(TASK_REPOSITORY) private taskRepo: TaskRepository,
    @Inject(JOB_DISPATCHER) private jobs: JobDispatcher,
  ) {}

  @Cron('0 9 * * *', { description: 'Send overdue task reminders', timezone: 'UTC' })
  async overdueReminders() {
    const overdueTasks = await this.taskRepo.findOverdue()

    for (const task of overdueTasks) {
      // Repository owns the assignee lookup — the cron job doesn't care
      // whether assignees are an embedded array or a separate table.
      const assignees = await this.taskRepo.findAssignees(task.id)

      for (const assignee of assignees) {
        await this.jobs.dispatch('email', 'send-overdue-reminder', {
          email: assignee.email,
          taskKey: task.key,
          taskTitle: task.title,
          dueDate: task.dueDate?.toISOString(),
        })
      }
    }
  }
}
```

Keeping the query behind a repository method (`findOverdue()`, `findAssignees()`) keeps the cron job database-agnostic — the storage shape (embedded array vs. join table) is the repository's concern, not the scheduler's.

### Token Cleanup (Daily at 3am)

Simple bulk delete of expired refresh tokens:

```typescript
@Cron('0 3 * * *', { description: 'Clean up expired refresh tokens', timezone: 'UTC' })
async cleanupTokens() {
  await this.tokenRepo.deleteExpired(new Date())
}
```

### Health Check (Every minute)

Monitors database and queue connectivity:

```typescript
@Cron('* * * * *', { description: 'Run system health check every minute' })
async healthCheck() {
  const results = { database: false, queues: false }

  try {
    await this.healthRepo.ping()
    results.database = true
  } catch { /* ignore */ }

  try {
    const queueNames = this.queueService.getQueueNames()
    results.queues = queueNames.length > 0
  } catch { /* ignore */ }

  if (results.database && results.queues) {
    logger.info('Health OK — database: ✓, queues: ✓')
  } else {
    logger.warn(`Health DEGRADED — database: ${results.database ? '✓' : '✗'}, queues: ${results.queues ? '✓' : '✗'}`)
  }
}
```

The health check delegates the connectivity probe to a repository `ping()` — a lightweight round-trip (e.g. `SELECT 1` on SQL, a `ping` command on the driver) that confirms the database is reachable. (`queueService` here is `QueueService`, injected with `@Inject(QUEUE_MANAGER)` from `@forinda/kickjs-queue`.)

::: tip Prefer readiness checks to a health cron
`QueueAdapter` already reports to `/health/ready` (it PINGs Redis), and any adapter can add its own probe with `onHealthCheck` — see [Adapters → Health check](./adapters.md#health-check-adapter). A cron that only logs is useful for a trend; a load balancer reads `/health/ready`.
:::

## Adapter Ordering Matters

The adapter array in `src/config/adapters.ts` runs `beforeStart()` in order (unless an adapter declares `dependsOn`). Dependencies must come first:

```typescript
export const adapters = [
  dbAdapter, // 1. Database — everything depends on this
  wsAdapter, // 2. WebSocket — before DevTools
  queueAdapter, // 3. Queues — binds JOB_DISPATCHER / QUEUE_MANAGER
  KickCronAdapter(), // 4. Cron — starts in afterStart, once every adapter is ready
  DevToolsAdapter({ // 5. DevTools — after ws, queue (monitors them)
    adapters: [wsAdapter, queueAdapter],
  }),
  SwaggerAdapter({...}), // 6. Swagger — last (reads all routes)
]
```

The mailer is no longer an adapter — it's a plugin (`bootstrap({ plugins })`), registered before any adapter starts. `KickCronAdapter` schedules jobs in `afterStart`, after every adapter's `beforeStart` has run, so the first tick always finds `JOB_DISPATCHER` bound. The database adapter comes first because the cron jobs' repositories depend on it.

## Email Provider Strategy

The mailer is a plugin that binds `MailerService` in the container ([Mailers](./mailer.md) has the full recipe). It picks the provider by environment — a console mailer in development, a real one in production:

```typescript
// src/plugins/mailer.plugin.ts
import { definePlugin, getEnv } from '@forinda/kickjs'
// Your app's own factories: an SMTP mailer, and one that logs emails to stdout.
import { MailerService, buildMailer, buildConsoleMailer } from '@/services/mailer.service'

const isDev = ['development', 'test'].includes(getEnv('NODE_ENV'))

export const MailerPlugin = definePlugin({
  name: 'MailerPlugin',
  build: () => ({
    register(container) {
      container.registerInstance(
        MailerService,
        // Only development and test log; anything else, including an unset
        // NODE_ENV, sends for real.
        isDev
          ? buildConsoleMailer()
          : buildMailer({ smtpUrl: getEnv('SMTP_URL'), defaultFrom: getEnv('MAIL_FROM_EMAIL') }),
      )
    },
  }),
})
```

The email processor code doesn't change — it calls `this.mailer.send()` regardless of the provider.

## What We'd Improve

1. **Add retry configuration** — BullMQ supports `attempts` and `backoff` per job. Critical emails (password reset) should retry more aggressively than digest emails.

2. **Add dead letter queues** — Jobs that fail after all retries should go to a DLQ for manual inspection.

3. **Move presence to Redis** — The in-memory presence map doesn't work with multiple server instances. A Redis hash with TTL-based expiry would fix this.

4. **Add job priority** — Welcome emails should have higher priority than daily digests.

## Series Conclusion

Over five articles, we've covered:

1. **Repository-backed data access** — type-safe repositories, DI tokens, swapping the storage layer without touching callers
2. **Module architecture** — generator scaffolding, shared patterns, DI tokens
3. **Query parsing & pagination** — Column-based configs, baseCondition, the evolution across framework versions
4. **Real-time features** — SSE for dashboards, WebSocket for chat
5. **Background jobs** — queue processors, cron jobs, adapter ordering

The full source code is available with 30+ commits showing the sequential build process — each epic committed independently so you can trace how the codebase evolved.
