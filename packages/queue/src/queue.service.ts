import type { Queue, JobsOptions } from 'bullmq'
import { Logger } from '@forinda/kickjs'

const log = Logger.for('QueueService')

/** Data shape for bulk job insertion */
export interface BulkJobEntry {
  name: string
  data: any
  opts?: JobsOptions
}

/**
 * Injectable service for adding jobs to BullMQ queues.
 *
 * Resolved from DI via `@Inject(QUEUE_MANAGER)`.
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
export class QueueService {
  private queues = new Map<string, Queue>()

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
    const queue = this.queues.get(queueName)
    if (!queue) {
      throw new Error(`Queue "${queueName}" not found. Did you register it in QueueAdapter?`)
    }
    const result = await queue.addBulk(jobs)
    log.debug(`Bulk jobs added: ${queueName} (count: ${result.length})`)
    return result
  }

  /** Get all registered queue names */
  getQueueNames(): string[] {
    return Array.from(this.queues.keys())
  }

  /** Close all queues gracefully */
  async closeAll(): Promise<void> {
    for (const [name, queue] of this.queues) {
      await queue.close()
      log.debug(`Queue closed: ${name}`)
    }
    this.queues.clear()
  }
}
