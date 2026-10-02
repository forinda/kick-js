import type { Job as BullMQJob, Queue, Worker } from 'bullmq'
import {
  JOB_DISPATCHER,
  Logger,
  defineAdapter,
  listJobHandlers,
  reportError,
  runJob,
  Scope,
} from '@forinda/kickjs'
import {
  PROTOCOL_VERSION,
  type IntrospectionSnapshot,
  type JobInspector,
} from '@forinda/kickjs-devtools-kit'
import { QUEUE_MANAGER, type QueueAdapterOptions } from './types'
import { QueueService } from './queue.service'
import { bullmqInspector } from './inspector'

const log = Logger.for('QueueAdapter')

/**
 * Public extension methods exposed by a QueueAdapter instance — the
 * stats helpers DevTools consumes to render the queue dashboard.
 */
export interface QueueAdapterExtensions {
  /** Get all registered queue names (used by DevTools). */
  getQueueNames(): string[]
  /** Get stats for a specific queue (used by DevTools). */
  getQueueStats(name: string): Promise<Record<string, any>>
  /** Browse and manage jobs — the DevTools Queues tab calls this. */
  jobInspector(): JobInspector
}

/**
 * BullMQ adapter for KickJS — creates queues and workers, wires @Job/@Process
 * decorated classes as job processors, and registers a QueueService in DI.
 *
 * @example
 * ```ts
 * import { QueueAdapter } from '@forinda/kickjs-queue'
 *
 * bootstrap({
 *   modules: [EmailModule],
 *   adapters: [
 *     QueueAdapter({
 *       redis: { host: 'localhost', port: 6379 },
 *       queues: ['email', 'notifications'],
 *       concurrency: 5,
 *     }),
 *   ],
 * })
 * ```
 */
export const QueueAdapter = defineAdapter<QueueAdapterOptions, QueueAdapterExtensions>({
  name: 'QueueAdapter',
  defaults: {
    queues: [],
    concurrency: 1,
  },
  build: (options) => {
    const workers: Worker[] = []
    const queueService = new QueueService(options.provider)
    let jobClassCount = 0

    const getQueueNames = (): string[] => queueService.getQueueNames()

    const getQueueStats = async (name: string): Promise<Record<string, any>> => {
      const queue = queueService.getQueue(name)
      if (!queue) return { error: 'Queue not found' }
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
      } catch {
        return { error: 'Stats unavailable' }
      }
    }

    return {
      getQueueNames,
      getQueueStats,

      // ── DevTools introspection (architecture.md §23) ─────────────
      // Cheap snapshot — counts only, no Redis round trip. The full
      // per-queue stats are still served via the existing
      // `/_debug/queues` endpoint for adopters who need them.
      introspect(): IntrospectionSnapshot {
        return {
          protocolVersion: PROTOCOL_VERSION,
          name: 'QueueAdapter',
          kind: 'adapter',
          state: options.redis
            ? { redisHost: options.redis.host, redisPort: options.redis.port }
            : { provider: options.provider.constructor?.name ?? 'custom' },
          tokens: { provides: ['kick/queue/Manager'], requires: [] },
          metrics: {
            registeredQueues: queueService.getQueueNames().length,
            activeWorkers: workers.length,
            registeredJobClasses: jobClassCount,
          },
        }
      },

      /** Lets the DevTools Queues tab list, inspect, retry and remove jobs. */
      jobInspector: () =>
        bullmqInspector(
          () => queueService.getQueueNames(),
          (name) => queueService.getQueue(name),
        ),

      async beforeStart({ container }) {
        const { queues: preCreateQueues = [], concurrency = 1 } = options

        // Every @Job / @Process the container can resolve — `@Job` and
        // `@Process` live in @forinda/kickjs, and runJob() routes each job.
        const handlers = listJobHandlers(container)
        jobClassCount = new Set(handlers.map((h) => h.target)).size
        const handled = [...new Set(handlers.map((h) => h.queue))]

        if (options.provider) {
          const provider = options.provider
          for (const name of new Set([...preCreateQueues, ...handled])) {
            queueService.registerQueue(name, (provider.getQueue?.(name) ?? { name }) as Queue)
          }
          for (const name of handled) {
            provider.createWorker(
              name,
              (job) => runJob(container, name, job).then(() => {}),
              concurrency,
            )
            log.info(`Worker started: ${name} (provider, concurrency: ${concurrency})`)
          }
        } else {
          // Loaded here, not at the top: with a `provider`, BullMQ needn't be installed.
          const { Queue, Worker } = await import('bullmq')
          const { host, port, password } = options.redis
          const connection = { host, port, password }
          for (const name of new Set([...preCreateQueues, ...handled])) {
            if (!queueService.getQueue(name)) {
              queueService.registerQueue(name, new Queue(name, { connection }))
            }
          }
          // Errors runJob already reported; the 'failed' event reports the rest
          // (a stalled job, a timeout) without reporting one twice.
          const reported = new WeakSet<object>()
          for (const name of handled) {
            const worker = new Worker(
              name,
              // The BullMQ job itself goes to the handler, so it keeps
              // job.attemptsMade, job.updateProgress() and the rest.
              async (job: BullMQJob) => {
                try {
                  return await runJob(container, name, job, { attemptsMade: job.attemptsMade })
                } catch (err) {
                  if (err && typeof err === 'object') reported.add(err)
                  throw err
                }
              },
              { connection, concurrency },
            )
            worker.on('failed', (job, err) => {
              if (reported.has(err)) return
              log.error({ err }, `Job failed: ${name}/${job?.name} (id: ${job?.id})`)
              reportError(err, {
                source: 'job',
                context: {
                  queue: name,
                  job: job?.name,
                  id: job?.id,
                  attemptsMade: job?.attemptsMade,
                },
              })
            })
            worker.on('completed', (job) => {
              log.debug(`Job completed: ${name}/${job.name} (id: ${job.id})`)
            })
            workers.push(worker)
            log.info(`Worker started: ${name} (concurrency: ${concurrency})`)
          }
        }

        // QueueService under both tokens: the queue-specific one, and the
        // tool-neutral dispatcher app code should prefer.
        container.registerFactory(QUEUE_MANAGER, () => queueService, Scope.SINGLETON)
        container.registerFactory(JOB_DISPATCHER, () => queueService, Scope.SINGLETON)

        log.info(
          `QueueAdapter ready — ${queueService.getQueueNames().length} queue(s), ${handled.length} worker(s)`,
        )
      },

      async shutdown() {
        if (options.provider) {
          await options.provider.shutdown()
          await queueService.closeAll()
          return
        }
        // Close workers first so they stop picking up new jobs
        for (const worker of workers) {
          await worker.close()
        }
        log.info(`Closed ${workers.length} worker(s)`)
        workers.length = 0

        // Then close queues
        await queueService.closeAll()
        log.info('All queues closed')
      },
    }
  },
})
