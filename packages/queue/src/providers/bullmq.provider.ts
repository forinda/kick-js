import type { QueueProvider } from '../types'

/**
 * BullMQ queue provider — uses Redis via BullMQ.
 * Requires: `pnpm add bullmq ioredis`
 */
export class BullMQProvider implements QueueProvider {
  private queues = new Map<string, any>()
  private workers = new Map<string, any>()

  constructor(
    private redis: { host: string; port: number; password?: string },
    private defaultConcurrency = 1,
  ) {}

  async addJob(queue: string, name: string, data: any, opts?: any) {
    const q = this.getOrCreateQueue(queue)
    return q.add(name, data, opts)
  }

  async addBulk(queue: string, jobs: Array<{ name: string; data: any; opts?: any }>) {
    const q = this.getOrCreateQueue(queue)
    return q.addBulk(jobs)
  }

  createWorker(
    queue: string,
    processor: (job: { name: string; data: any; id?: string }) => Promise<void>,
    concurrency?: number,
  ) {
    const { Worker } = require('bullmq')
    const worker = new Worker(
      queue,
      async (job: any) => processor({ name: job.name, data: job.data, id: job.id }),
      { connection: this.redis, concurrency: concurrency ?? this.defaultConcurrency },
    )
    this.workers.set(queue, worker)
    return worker
  }

  getQueue(name: string) {
    return this.getOrCreateQueue(name)
  }

  async shutdown() {
    await Promise.all([...this.workers.values()].map((w) => w.close()))
    await Promise.all([...this.queues.values()].map((q) => q.close()))
  }

  private getOrCreateQueue(name: string) {
    if (!this.queues.has(name)) {
      const { Queue } = require('bullmq')
      this.queues.set(name, new Queue(name, { connection: this.redis }))
    }
    return this.queues.get(name)!
  }
}
