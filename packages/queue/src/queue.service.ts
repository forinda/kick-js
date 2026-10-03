import type { Queue, JobsOptions } from 'bullmq'
import { Logger, stampJobContext, type JobDispatcher } from '@forinda/kickjs'
import type { QueueProvider } from './types'

const log = Logger.for('QueueService')

/** Data shape for bulk job insertion */
export interface BulkJobEntry {
  name: string
  data: any
  opts?: JobsOptions
}

/**
 * Injectable service for adding jobs — to BullMQ queues, or through the
 * adapter's `provider`. Also the app's {@link JobDispatcher}.
 *
 * Resolved from DI via `@Inject(QUEUE_MANAGER)` or `@Inject(JOB_DISPATCHER)`.
 *
 * @example
 * ```ts
 * @Service()
 * class EmailService {
 *   @Inject(QUEUE_MANAGER) private queue: QueueService
 *
 *   async sendWelcome(userId: string) {
 *     await this.queue.add('email', 'welcome', { userId })
 *   }
 * }
 * ```
 */
export class QueueService implements JobDispatcher {
  private queues = new Map<string, Queue>()

  /** With a provider, jobs go through it rather than BullMQ queues. */
  constructor(private readonly provider?: QueueProvider) {}

  /** Register a queue instance (called by the adapter) */
  registerQueue(name: string, queue: Queue): void {
    this.queues.set(name, queue)
    log.debug(`Queue registered: ${name}`)
  }

  /** Get a raw BullMQ Queue instance by name */
  getQueue(name: string): Queue | undefined {
    return this.queues.get(name)
  }

  /** Add a single job to a queue */
  async add(queueName: string, jobName: string, data: any, opts?: JobsOptions) {
    if (this.provider) return this.provider.addJob(queueName, jobName, data, opts)
    const queue = this.queues.get(queueName)
    if (!queue) {
      throw new Error(`Queue "${queueName}" not found. Did you register it in QueueAdapter?`)
    }
    const job = await queue.add(jobName, data, opts)
    log.debug(`Job added: ${queueName}/${jobName} (id: ${job.id})`)
    return job
  }

  /** Add multiple jobs to a queue in bulk */
  async addBulk(queueName: string, jobs: BulkJobEntry[]) {
    if (this.provider) {
      return this.provider.addBulk
        ? this.provider.addBulk(queueName, jobs)
        : Promise.all(jobs.map((j) => this.provider!.addJob(queueName, j.name, j.data, j.opts)))
    }
    const queue = this.queues.get(queueName)
    if (!queue) {
      throw new Error(`Queue "${queueName}" not found. Did you register it in QueueAdapter?`)
    }
    const result = await queue.addBulk(jobs)
    log.debug(`Bulk jobs added: ${queueName} (count: ${result.length})`)
    return result
  }

  /** {@link JobDispatcher}: enqueue a job without naming the backend. */
  dispatch<Data = unknown>(
    queue: string,
    name: string,
    data: Data,
    options?: Record<string, unknown>,
  ): Promise<unknown> {
    // The dispatching code's job context (tenant, trace) travels with the job.
    return this.add(queue, name, stampJobContext(data), options as JobsOptions)
  }

  /** Get all registered queue names */
  getQueueNames(): string[] {
    return Array.from(this.queues.keys())
  }

  /** Close all queues gracefully */
  async closeAll(): Promise<void> {
    for (const [name, queue] of this.queues) {
      // Provider-backed entries may have no close(); the provider shuts down itself.
      await queue.close?.()
      log.debug(`Queue closed: ${name}`)
    }
    this.queues.clear()
  }
}
