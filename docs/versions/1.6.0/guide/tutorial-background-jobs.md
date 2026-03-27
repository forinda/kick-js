# Background Jobs and Scheduled Tasks in Node.js

*Part 5 of "Building a Jira Clone with KickJS + Drizzle ORM"*

---

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

| Queue | Processor | Jobs |
|-------|-----------|------|
| `email` | EmailProcessor | send-welcome, send-task-assigned, send-mentioned, send-overdue-reminder, send-workspace-invite, send-daily-digest |
| `notifications` | NotificationProcessor | create-notification |
| `activity` | ActivityProcessor | log-activity |

## Queue Processor Pattern

Each processor is a `@Service()` class decorated with `@Job(queueName)`. Individual methods are decorated with `@Process(jobName)`:

```typescript
import { Service, Logger, Autowired } from '@forinda/kickjs-core'
import { Job, Process } from '@forinda/kickjs-queue'
import type { Job as BullMQJob } from 'bullmq'
import { MAILER, type MailerService } from '@forinda/kickjs-mailer'

@Service()
@Job('email')
export class EmailProcessor {
  @Autowired(MAILER) private mailer!: MailerService

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

The `@Autowired(MAILER)` injects the mailer service — which is either `ResendMailProvider` in production or `ConsoleProvider` in development (logs emails to stdout instead of sending them).

## Dispatching Jobs

Use cases dispatch jobs via the `QueueService`:

```typescript
// In a use case constructor
@Inject(QUEUE_MANAGER) private queueService: QueueService

// Dispatching
await this.queueService.add('email', 'send-welcome-email', {
  email: user.email,
  firstName: user.firstName,
})

await this.queueService.add('notifications', 'create-notification', {
  recipientId: mentionedUserId,
  type: 'mentioned',
  title: `You were mentioned in ${task.key}`,
  body: `${commenter.email} mentioned you in a comment`,
  metadata: { taskId: task.id, commentId: comment.id },
})
```

Jobs are typed via the `BullMQJob<T>` generic on the processor method — but there's no compile-time check between dispatch and consumption. This is a trade-off of queue-based architectures.

## Queue Module: The No-Routes Module

The queue module has no HTTP endpoints. It exists only to register processor classes in the DI container:

```typescript
export class QueueModule implements AppModule {
  register(_container: Container): void {
    // No manual registration — QueueAdapter auto-registers @Job classes
  }

  routes(): ModuleRoutes | null {
    return null  // No HTTP routes
  }
}
```

The `import.meta.glob` in the module index eagerly loads processor files so `@Job()` and `@Process()` decorators register before the queue adapter starts consuming.

## Cron Jobs

Scheduled tasks use `@forinda/kickjs-cron`. Unlike queue processors, cron jobs are NOT registered via a module — they're passed directly to the `CronAdapter`:

```typescript
// config/adapters.ts
new CronAdapter({
  services: [
    TaskCronJobs,
    CleanupCronJobs,
    HealthCheckCronJobs,
    DigestCronJobs,
    PresenceCronJobs,
  ],
  enabled: true,
})
```

### Overdue Task Reminders (Daily at 9am)

The most complex cron job queries for overdue tasks, looks up assignees via the join table, and dispatches email jobs:

```typescript
@Service()
export class TaskCronJobs {
  constructor(
    @Inject(DRIZZLE_DB) private db: PostgresJsDatabase,
    @Inject(QUEUE_MANAGER) private queueService: QueueService,
  ) {}

  @Cron('0 9 * * *', { description: 'Send overdue task reminders', timezone: 'UTC' })
  async overdueReminders() {
    const overdueTasks = await this.db
      .select({ taskId: tasks.id, taskKey: tasks.key, taskTitle: tasks.title, dueDate: tasks.dueDate })
      .from(tasks)
      .where(and(lt(tasks.dueDate, new Date()), ne(tasks.status, 'done')))

    for (const task of overdueTasks) {
      // Join table lookup — can't use task.assigneeIds like Mongoose
      const assignees = await this.db
        .select({ email: users.email })
        .from(taskAssignees)
        .innerJoin(users, eq(users.id, taskAssignees.userId))
        .where(eq(taskAssignees.taskId, task.taskId))

      for (const assignee of assignees) {
        await this.queueService.add('email', 'send-overdue-reminder', {
          email: assignee.email,
          taskKey: task.taskKey,
          taskTitle: task.taskTitle,
          dueDate: task.dueDate?.toISOString(),
        })
      }
    }
  }
}
```

Note the Drizzle-specific difference from Mongoose: we can't do `task.assigneeIds.forEach(...)` because assignees live in a separate join table. We need an explicit `innerJoin` query.

### Token Cleanup (Daily at 3am)

Simple bulk delete of expired refresh tokens:

```typescript
@Cron('0 3 * * *', { description: 'Clean up expired refresh tokens', timezone: 'UTC' })
async cleanupTokens() {
  await this.db.delete(refreshTokens).where(lt(refreshTokens.expiresAt, new Date()))
}
```

### Health Check (Every minute)

Monitors PostgreSQL and queue connectivity:

```typescript
@Cron('* * * * *', { description: 'Run system health check every minute' })
async healthCheck() {
  const results = { postgres: false, queues: false }

  try {
    await this.db.execute(sql`SELECT 1`)
    results.postgres = true
  } catch { /* ignore */ }

  try {
    const queueNames = this.queueService.getQueueNames()
    results.queues = queueNames.length > 0
  } catch { /* ignore */ }

  if (results.postgres && results.queues) {
    logger.info('Health OK — postgres: ✓, queues: ✓')
  } else {
    logger.warn(`Health DEGRADED — postgres: ${results.postgres ? '✓' : '✗'}, queues: ${results.queues ? '✓' : '✗'}`)
  }
}
```

The Mongoose edition checked `mongoose.connection.readyState === 1`. The Drizzle edition uses `SELECT 1` — a universal PostgreSQL health check.

## Adapter Ordering Matters

The adapter array in `config/adapters.ts` runs `beforeStart()` in order. Dependencies must come first:

```typescript
export const adapters = [
  drizzleAdapter,           // 1. Database — everything depends on this
  wsAdapter,                // 2. WebSocket — before DevTools
  new MailerAdapter({...}), // 3. Email — before queue (processors need MAILER)
  queueAdapter,             // 4. Queues — after Redis, Mailer
  new CronAdapter({...}),   // 5. Cron — after queue (cron jobs dispatch to queues)
  new DevToolsAdapter({     // 6. DevTools — after ws, queue (monitors them)
    adapters: [wsAdapter, queueAdapter],
  }),
  new SwaggerAdapter({...}),// 7. Swagger — last (reads all routes)
]
```

If you put `CronAdapter` before `QueueAdapter`, the overdue reminders cron will fail because `QUEUE_MANAGER` isn't registered yet.

## Email Provider Strategy

Development uses `ConsoleProvider` which logs emails to stdout:

```typescript
new MailerAdapter({
  provider: new ConsoleProvider(),
  defaultFrom: { name: env.MAIL_FROM_NAME, address: env.MAIL_FROM_EMAIL },
})
```

For production, swap to Resend:

```typescript
new MailerAdapter({
  provider: env.NODE_ENV === 'production'
    ? new ResendMailProvider(env.RESEND_API_KEY)
    : new ConsoleProvider(),
  defaultFrom: { name: env.MAIL_FROM_NAME, address: env.MAIL_FROM_EMAIL },
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

1. **Why Drizzle over Mongoose** — type safety, join tables, transactions
2. **DDD module architecture** — generator scaffolding, shared patterns, DI tokens
3. **Query parsing & pagination** — Column-based configs, baseCondition, the evolution across framework versions
4. **Real-time features** — SSE for dashboards, WebSocket for chat
5. **Background jobs** — queue processors, cron jobs, adapter ordering

The full source code is available with 30+ commits showing the sequential build process — each epic committed independently so you can trace how the codebase evolved.
