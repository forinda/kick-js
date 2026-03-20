import type { QueueProvider } from '../types'

/**
 * Redis Pub/Sub provider — lightweight message passing without BullMQ.
 * No job persistence, retries, or delayed jobs — just fire-and-forget pub/sub.
 * Good for event broadcasting, cache invalidation, and real-time notifications.
 * Requires: `pnpm add ioredis`
 */
export class RedisPubSubProvider implements QueueProvider {
  private publisher: any = null
  private subscriber: any = null
  private subscriptions = new Map<string, (job: any) => Promise<void>>()

  constructor(private redis: { host: string; port: number; password?: string }) {}

  private ensurePublisher() {
    if (!this.publisher) {
      const Redis = require('ioredis')
      this.publisher = new Redis(this.redis)
    }
    return this.publisher
  }

  private ensureSubscriber() {
    if (!this.subscriber) {
      const Redis = require('ioredis')
      this.subscriber = new Redis(this.redis)

      this.subscriber.on('message', async (channel: string, message: string) => {
        const processor = this.subscriptions.get(channel)
        if (processor) {
          const job = JSON.parse(message)
          await processor(job)
        }
      })
    }
    return this.subscriber
  }

  async addJob(queue: string, name: string, data: any) {
    const pub = this.ensurePublisher()
    const message = JSON.stringify({ name, data, timestamp: Date.now() })
    await pub.publish(queue, message)
    return { channel: queue, name }
  }

  async addBulk(queue: string, jobs: Array<{ name: string; data: any }>) {
    const results = []
    for (const job of jobs) {
      results.push(await this.addJob(queue, job.name, job.data))
    }
    return results
  }

  createWorker(
    queue: string,
    processor: (job: { name: string; data: any; id?: string }) => Promise<void>,
  ) {
    const sub = this.ensureSubscriber()
    this.subscriptions.set(queue, processor)
    sub.subscribe(queue)
  }

  getQueue(name: string) {
    return { name, type: 'redis-pubsub' }
  }

  async shutdown() {
    if (this.subscriber) {
      await this.subscriber.unsubscribe()
      this.subscriber.disconnect()
    }
    if (this.publisher) {
      this.publisher.disconnect()
    }
  }
}
