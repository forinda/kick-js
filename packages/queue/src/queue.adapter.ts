import { Queue, Worker, type Job as BullMQJob } from 'bullmq'
import {
  Logger,
  defineAdapter,
  Scope,
  getClassMetaOrUndefined,
  getClassMeta,
} from '@forinda/kickjs'
import {
  QUEUE_MANAGER,
  QUEUE_METADATA,
  jobRegistry,
  type QueueAdapterOptions,
  type ProcessDefinition,
} from './types'
import { QueueService } from './queue.service'

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
    const queueService = new QueueService()

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

      beforeStart({ container }) {
        const { redis, queues: preCreateQueues = [], concurrency = 1 } = options

        const connection = { host: redis.host, port: redis.port, password: redis.password }

        // Pre-create any explicitly listed queues
        for (const name of preCreateQueues) {
          if (!queueService.getQueue(name)) {
            const queue = new Queue(name, { connection })
            queueService.registerQueue(name, queue)
          }
        }

        // Discover all @Job-decorated classes and wire workers
        for (const jobClass of jobRegistry) {
          const queueName = getClassMetaOrUndefined<string>(QUEUE_METADATA.JOB, jobClass)
          if (queueName === undefined) continue

          const handlers = getClassMeta<ProcessDefinition[]>(QUEUE_METADATA.PROCESS, jobClass, [])

          if (handlers.length === 0) {
            log.warn(
              `@Job('${queueName}') class ${jobClass.name} has no @Process methods — skipping`,
            )
            continue
          }

          // Ensure the queue exists
          if (!queueService.getQueue(queueName)) {
            const queue = new Queue(queueName, { connection })
            queueService.registerQueue(queueName, queue)
          }

          // Auto-register the @Job class if not already in the container.
          // @Service()/@Job() set metadata but don't always call container.register(),
          // especially after HMR rebuilds which reset the container.
          if (!container.has(jobClass)) {
            container.register(jobClass, jobClass)
          }

          // Resolve the processor instance from DI
          const processor = container.resolve(jobClass)

          // Build the worker processor function
          const worker = new Worker(
            queueName,
            async (job: BullMQJob) => {
              const specific = handlers.find((h) => h.jobName === job.name)
              const handler = specific || handlers.find((h) => h.jobName === undefined)

              if (handler) {
                await processor[handler.handlerName](job)
              } else {
                log.warn(`No handler for job "${job.name}" in queue "${queueName}"`)
              }
            },
            { connection, concurrency },
          )

          worker.on('failed', (job, err) => {
            log.error({ err }, `Job failed: ${queueName}/${job?.name} (id: ${job?.id})`)
          })

          worker.on('completed', (job) => {
            log.debug(`Job completed: ${queueName}/${job.name} (id: ${job.id})`)
          })

          workers.push(worker)
          log.info(
            `Worker started: ${queueName} (${jobClass.name}, ${handlers.length} handler(s), concurrency: ${concurrency})`,
          )
        }

        // Register the QueueService in DI
        container.registerFactory(QUEUE_MANAGER, () => queueService, Scope.SINGLETON)

        log.info(
          `QueueAdapter ready — ${queueService.getQueueNames().length} queue(s), ${workers.length} worker(s)`,
        )
      },

      async shutdown() {
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
