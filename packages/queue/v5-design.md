# `@forinda/kickjs-queue` v5 — slim shape

## Why slim instead of drop

Queue earns its keep where the other 6 deprecated wrappers didn't:

- **Stable upstream** — BullMQ has been API-stable for years; no quarterly churn to chase.
- **Genuine framework value** — `@Job` / `@Process` decorator discovery + worker lifecycle wiring is ~150 LOC adopters would rewrite per project.
- **No `process.on` collision** — graceful shutdown integrates via the framework's `shutdown()` hook, not a competing signal handler.
- **DevTools wiring already correct** — `introspect()` + `devtoolsTabs()` slots are framework-agnostic; they work for any queue shape.

What v5 drops is the **multi-provider abstraction** — 4 provider classes (`BullMQProvider`, `RabbitMQProvider`, `KafkaProvider`, `RedisPubSubProvider`, ~320 LOC total) that nobody actually resolves. The adapter imports BullMQ directly today; the abstraction was aspirational.

## Current shape (v4.x)

```
packages/queue/src/
├── decorators.ts            ~60 LOC  @Job / @Process
├── queue.service.ts         ~80 LOC  QueueService (BullMQ-typed)
├── queue.adapter.ts        ~360 LOC  BullMQ-locked adapter
├── types.ts                 ~70 LOC  QueueProvider interface (unused)
├── providers/
│   ├── bullmq.provider.ts   ~60 LOC  unused
│   ├── kafka.provider.ts   ~105 LOC  unused
│   ├── rabbitmq.provider.ts ~80 LOC  unused
│   ├── redis-pubsub.provider.ts ~80 LOC  unused
│   └── index.ts             ~5 LOC
└── index.ts                 ~10 LOC
                            ────────
                            ~905 LOC total
```

## v5 shape

```
packages/queue/src/
├── decorators.ts        ~60 LOC  @Job / @Process — unchanged
├── queue.adapter.ts    ~180 LOC  defineAdapter that takes the adopter's BullMQ client
├── types.ts             ~30 LOC  metadata key + interfaces only
└── index.ts             ~10 LOC
                        ────────
                        ~280 LOC total  (~70% reduction)
```

The diff: drop `providers/`, drop `QueueService`'s BullMQ-typed wrapper, drop `redis: { host, port }` config. Adopters bring their own BullMQ `Queue` / `Worker` instances; we wire decorators against them.

## Public surface

### Decorators (unchanged)

```ts
import { Job, Process } from '@forinda/kickjs-queue'

@Job('email')
export class EmailProcessor {
  @Process('welcome')
  async sendWelcome(job: BullMQJob<{ to: string }>) {
    await sendEmail(job.data.to)
  }

  @Process()                  // fallback for unhandled job names
  async catchAll(job: BullMQJob) {
    log.warn(`Unhandled job: ${job.name}`)
  }
}
```

The decorators stay identical so v4 → v5 source migration is zero-touch for handler code.

### `QueueAdapter` factory (new shape)

```ts
import { Queue, Worker } from 'bullmq'
import IORedis from 'ioredis'
import { bootstrap } from '@forinda/kickjs'
import { QueueAdapter, jobRegistry } from '@forinda/kickjs-queue'
import { EmailProcessor } from './processors/email.processor'

// Adopter owns the connection + queue instances
const connection = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null })
const emailQueue = new Queue('email', { connection })
const notificationsQueue = new Queue('notifications', { connection })

export const app = await bootstrap({
  modules,
  adapters: [
    QueueAdapter({
      // Map decorated processor classes to their BullMQ Queue instance.
      // The adapter walks @Process metadata, instantiates each class
      // through DI, and creates a Worker bound to the supplied queue.
      processors: [
        { handler: EmailProcessor, queue: emailQueue },
      ],

      // Adopter's choice: same connection for workers, or a separate one.
      // Workers are created by the adapter using BullMQ's Worker constructor.
      connection,

      // Optional: override default concurrency. Default = 1.
      concurrency: { email: 5 },

      // Optional: anything else BullMQ Worker accepts (limiter, settings, etc.)
      // Adopter passes whatever they want; framework doesn't filter.
      workerOptions: { autorun: true },
    }),
  ],
})
```

**What changed vs v4:**

| Concern | v4 (today) | v5 (slim) |
|---|---|---|
| Connection | `redis: { host, port, password }` config | Adopter passes their own `IORedis` instance |
| Queue instances | Adapter creates them from `queues: ['email', ...]` array | Adopter creates `new Queue('email', ...)` and hands them in |
| `QueueService` | DI-injectable BullMQ-typed `Queue` map | Removed — adopters inject the BullMQ `Queue` directly |
| Decorator discovery | `jobRegistry` global Set populated by `@Job` | Unchanged |
| Worker creation | Internal | Adapter calls `new Worker(queueName, processor, options)` per decorated class |
| Multi-provider | `QueueProvider` interface + 4 unused classes | Removed; adopters who want RabbitMQ/Kafka write their own `defineAdapter` (sibling BYO recipe in `docs/guide/queue-byo.md`) |
| Graceful shutdown | `worker.close()` per worker, `queue.close()` per queue | `worker.close()` only — adopter closes their own queues + connection |

**Why adopter-owned connections matter:** v4 forced one connection-per-adapter, which conflicts with adopters who want to share connections across BullMQ + cache + rate limiter (the BullMQ docs explicitly recommend connection sharing). v5's "you bring it" model removes the constraint without adding code.

### `QueueService` removal — migration path

Today some adopters do:

```ts
@Inject(QUEUE_MANAGER) private queue: QueueService
await this.queue.add('email', 'welcome', { to: 'user@example.com' })
```

In v5, inject the BullMQ `Queue` directly via a token the adopter creates:

```ts
import { createToken } from '@forinda/kickjs'
import { Queue } from 'bullmq'

export const EMAIL_QUEUE = createToken<Queue>('app/queue/email')

// Bind once in a plugin
container.registerInstance(EMAIL_QUEUE, emailQueue)

// Use anywhere
@Inject(EMAIL_QUEUE) private email: Queue
await this.email.add('welcome', { to: 'user@example.com' })
```

One extra binding line per queue, in exchange for typed BullMQ access (no `getQueue('email')` runtime lookup that returns `Queue | undefined`).

For adopters who liked the `QueueService` aggregator, the BYO recipe in `docs/guide/queue-byo.md` shows how to write a thin local one in ~20 LOC.

## Implementation sketch

### `decorators.ts` (unchanged from v4)

Same `Job` / `Process` exports using `setClassMeta` / `pushClassMeta` and the framework metadata helpers. No change required.

### `types.ts` (slimmed)

```ts
import type { Queue, Worker, ConnectionOptions, WorkerOptions, Job as BullMQJob } from 'bullmq'

/** Mapping of one decorated processor class to its target queue. */
export interface ProcessorBinding {
  /** Class decorated with `@Job(queueName)` and `@Process(...)` methods. */
  handler: new (...args: any[]) => any
  /** BullMQ Queue instance the worker should consume from. */
  queue: Queue
}

/** Adapter config — adopter brings the BullMQ client + connection. */
export interface QueueAdapterOptions {
  /** Processors to wire. The adapter walks @Process metadata on each handler. */
  processors: ProcessorBinding[]
  /** Connection used to create Workers. Reuse your own IORedis for sharing. */
  connection: ConnectionOptions
  /** Per-queue concurrency override. Default = 1. */
  concurrency?: Record<string, number>
  /** Extra options forwarded to every `new Worker()` call. */
  workerOptions?: Omit<WorkerOptions, 'connection' | 'concurrency'>
}

/** Re-export the BullMQ Job type so adopters import it from us, not bullmq directly. */
export type { BullMQJob }

/** Metadata keys (unchanged from v4). */
export const QUEUE_METADATA = {
  JOB: 'kick/queue/job',
  PROCESS: 'kick/queue/process',
} as const

/** Internal: shape of `@Process` metadata. */
export interface ProcessDefinition {
  handlerName: string
  jobName?: string
}

/** @Job-decorated classes — populated at decoration time, consumed by the adapter. */
export const jobRegistry = new Set<any>()
```

No `QueueProvider` interface. No `QUEUE_MANAGER` token (adopters use their own).

### `queue.adapter.ts` (slimmed)

```ts
import { Worker, type Queue, type Job as BullMQJob } from 'bullmq'
import {
  Logger,
  defineAdapter,
  getClassMetaOrUndefined,
  getClassMeta,
  type AdapterContext,
} from '@forinda/kickjs'
import {
  defineDevtoolsTab,
  PROTOCOL_VERSION,
  type IntrospectionSnapshot,
} from '@forinda/kickjs-devtools-kit'
import { QUEUE_METADATA, type ProcessDefinition, type QueueAdapterOptions } from './types'

const log = Logger.for('QueueAdapter')

export interface QueueAdapterExtensions {
  /** All queues the adapter wired (used by DevTools). */
  getQueueNames(): string[]
  /** Live counts for one queue (used by DevTools). */
  getQueueStats(name: string): Promise<Record<string, number | string>>
}

export const QueueAdapter = defineAdapter<QueueAdapterOptions, QueueAdapterExtensions>({
  name: 'QueueAdapter',
  defaults: { concurrency: {} },
  build: (options) => {
    const workers: Worker[] = []
    const queues = new Map<string, Queue>()
    let totalProcessed = 0
    let totalFailed = 0

    const getStats = async (name: string) => {
      const queue = queues.get(name)
      if (!queue) return { error: `Queue '${name}' not found` }
      try {
        const counts = await queue.getJobCounts()
        return {
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          completed: counts.completed ?? 0,
          failed: counts.failed ?? 0,
          delayed: counts.delayed ?? 0,
          paused: counts.paused ?? 0,
        }
      } catch (err) {
        return { error: (err as Error).message }
      }
    }

    return {
      async beforeStart({ container }: AdapterContext) {
        for (const { handler: HandlerClass, queue } of options.processors) {
          const queueName = getClassMetaOrUndefined<string>(QUEUE_METADATA.JOB, HandlerClass)
          if (!queueName) {
            log.warn(`${HandlerClass.name} is not @Job-decorated; skipping`)
            continue
          }
          if (queue.name !== queueName) {
            log.warn(
              `${HandlerClass.name} declares @Job('${queueName}') but bound queue is '${queue.name}'. Decorator wins.`,
            )
          }
          queues.set(queueName, queue)

          // Build a name → handler dispatch table from @Process metadata.
          const processes = getClassMeta<ProcessDefinition[]>(
            QUEUE_METADATA.PROCESS,
            HandlerClass,
            [],
          )
          const namedHandlers = new Map<string, string>()
          let fallback: string | undefined
          for (const proc of processes) {
            if (proc.jobName) namedHandlers.set(proc.jobName, proc.handlerName)
            else fallback = proc.handlerName
          }

          // Resolve the handler instance through DI so @Autowired etc. wire.
          const instance = container.resolve(HandlerClass)

          const worker = new Worker(
            queueName,
            async (job: BullMQJob) => {
              const handlerName = namedHandlers.get(job.name) ?? fallback
              if (!handlerName) {
                throw new Error(
                  `${HandlerClass.name} has no @Process for job '${job.name}' and no fallback`,
                )
              }
              try {
                await instance[handlerName](job)
                totalProcessed++
              } catch (err) {
                totalFailed++
                throw err
              }
            },
            {
              ...options.workerOptions,
              connection: options.connection,
              concurrency: options.concurrency?.[queueName] ?? 1,
            },
          )
          workers.push(worker)
          log.info(
            `Worker bound: ${HandlerClass.name} → ${queueName} (concurrency: ${options.concurrency?.[queueName] ?? 1})`,
          )
        }
      },

      async shutdown() {
        // Workers only — adopters own queue lifecycle (close them in their
        // own shutdown, or let the connection close cascade).
        await Promise.allSettled(workers.map((w) => w.close()))
        log.info(`${workers.length} worker(s) closed`)
      },

      // ── DevTools hooks (unchanged behaviour, slimmer plumbing) ─────
      getQueueNames: () => [...queues.keys()],
      getQueueStats: getStats,

      introspect(): IntrospectionSnapshot {
        return {
          protocolVersion: PROTOCOL_VERSION,
          name: 'QueueAdapter',
          kind: 'adapter',
          state: { queues: [...queues.keys()] },
          metrics: {
            workerCount: workers.length,
            queueCount: queues.size,
            totalProcessed,
            totalFailed,
          },
        }
      },

      devtoolsTabs() {
        return [
          defineDevtoolsTab({
            id: 'queues',
            title: 'Queues',
            icon: 'mdi:queue',
            category: 'observability',
            view: { type: 'iframe', src: '/_debug/queues' },
          }),
        ]
      },
    }
  },
})
```

### `index.ts`

```ts
export { Job, Process } from './decorators'
export { QueueAdapter, type QueueAdapterExtensions } from './queue.adapter'
export {
  jobRegistry,
  QUEUE_METADATA,
  type BullMQJob,
  type ProcessDefinition,
  type ProcessorBinding,
  type QueueAdapterOptions,
} from './types'
```

No `QueueService`, no `QUEUE_MANAGER` token, no provider classes.

## v4 → v5 migration for adopters

```diff
+ import IORedis from 'ioredis'
+ import { Queue } from 'bullmq'
  import { bootstrap } from '@forinda/kickjs'
- import { QueueAdapter, QUEUE_MANAGER, QueueService } from '@forinda/kickjs-queue'
+ import { QueueAdapter } from '@forinda/kickjs-queue'
+ import { createToken } from '@forinda/kickjs'

+ const connection = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null })
+ const emailQueue = new Queue('email', { connection })
+ export const EMAIL_QUEUE = createToken<Queue>('app/queue/email')

  bootstrap({
    modules,
    adapters: [
      QueueAdapter({
-       redis: { host: 'localhost', port: 6379 },
-       queues: ['email'],
-       concurrency: 5,
+       processors: [{ handler: EmailProcessor, queue: emailQueue }],
+       connection,
+       concurrency: { email: 5 },
      }),
    ],
+   plugins: [
+     definePlugin({
+       name: 'QueueBindings',
+       build: () => ({
+         register(container) {
+           container.registerInstance(EMAIL_QUEUE, emailQueue)
+         },
+         async shutdown() {
+           await emailQueue.close()
+           await connection.quit()
+         },
+       }),
+     })(),
+   ],
  })
```

```diff
- @Inject(QUEUE_MANAGER) private queue: QueueService
+ @Inject(EMAIL_QUEUE) private queue: Queue

- await this.queue.add('email', 'welcome', { to })
+ await this.queue.add('welcome', { to })
```

The processor classes (`EmailProcessor` etc.) need **zero** changes — `@Job` and `@Process` decorators stay identical.

## Adopter-side BYO escape hatch

For adopters who want RabbitMQ / Kafka / SQS, the `docs/guide/queue-byo.md` recipe (sibling to `cron.md`) shows the same shape: local `@Job` decorator + `defineAdapter` + adopter's chosen client. The decorators in `@forinda/kickjs-queue` are BullMQ-flavoured (the worker shape is BullMQ-specific), so non-BullMQ adopters use the BYO recipe end-to-end. Reasonable cost — those adopters were rewriting the worker logic anyway.

## Open questions for review

1. **Keep `jobRegistry` global?** It's nice-to-have for `kick inspect` and DevTools but feels stale now that `processors` is explicit in `QueueAdapter` config. Could remove and have the adapter just iterate `options.processors` instead — saves the global state, costs adopters who relied on `jobRegistry` for introspection. Lean toward removing.

2. **Re-export `BullMQJob`?** Helps adopters avoid `import type { Job } from 'bullmq'` (collides with our `@Job`). Costs us a peer-dep type re-export. Lean toward keeping.

3. **Default concurrency from a top-level `defaults: { concurrency: 1 }` instead of per-queue map?** The per-queue map is more powerful but verbose for the common "all queues run at concurrency 1" case. Could accept `concurrency: number | Record<string, number>`. Lean toward the union.

4. **Drop `getQueueNames()` / `getQueueStats()` extension methods?** DevTools could read them off the introspect snapshot instead. Saves the `QueueAdapterExtensions` type. Lean toward dropping if DevTools is the only consumer.

## Sequencing

1. **Now (post v4.2)** — leave the queue package alone. The current v4.x users keep working.
2. **v4.3 minor** — add a runtime `console.warn` on import announcing the v5 shape change with a link to this doc and the migration diff. **Don't deprecate the package itself** — it's not going away, just changing shape.
3. **v5.0** — ship the slim shape. Move `QueueService`, `QUEUE_MANAGER`, and the 4 provider classes to `@removed.txt`. Update CHANGELOG with the diff above.

## What this is NOT

- Not a deprecation. The package stays.
- Not a "just delete the providers" patch. The slim shape removes `QueueService` too, which IS a breaking change to anyone who injected it.
- Not a guarantee — open to revising before v5 ships if real-world adopters need the connection abstraction back.
