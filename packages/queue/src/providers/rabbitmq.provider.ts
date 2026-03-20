import type { QueueProvider } from '../types'

/**
 * RabbitMQ queue provider — uses AMQP via amqplib.
 * Requires: `pnpm add amqplib @types/amqplib`
 */
export class RabbitMQProvider implements QueueProvider {
  private connection: any = null
  private channel: any = null
  private consumers: string[] = []

  constructor(private url: string) {}

  private async ensureChannel() {
    if (!this.channel) {
      const amqplib = require('amqplib')
      this.connection = await amqplib.connect(this.url)
      this.channel = await this.connection.createChannel()
    }
    return this.channel
  }

  async addJob(queue: string, name: string, data: any, opts?: any) {
    const ch = await this.ensureChannel()
    await ch.assertQueue(queue, { durable: true })
    const message = JSON.stringify({ name, data, timestamp: Date.now() })
    ch.sendToQueue(queue, Buffer.from(message), {
      persistent: true,
      ...opts,
    })
    return { queue, name }
  }

  async addBulk(queue: string, jobs: Array<{ name: string; data: any; opts?: any }>) {
    const results = []
    for (const job of jobs) {
      results.push(await this.addJob(queue, job.name, job.data, job.opts))
    }
    return results
  }

  createWorker(
    queue: string,
    processor: (job: { name: string; data: any; id?: string }) => Promise<void>,
    _concurrency?: number,
  ) {
    this.ensureChannel().then(async (ch: any) => {
      await ch.assertQueue(queue, { durable: true })
      if (_concurrency) ch.prefetch(_concurrency)

      const { consumerTag } = await ch.consume(queue, async (msg: any) => {
        if (!msg) return
        try {
          const job = JSON.parse(msg.content.toString())
          await processor({ name: job.name, data: job.data, id: msg.properties.messageId })
          ch.ack(msg)
        } catch {
          ch.nack(msg, false, true)
        }
      })

      this.consumers.push(consumerTag)
    })
  }

  getQueue(name: string) {
    return { name, type: 'rabbitmq' }
  }

  async shutdown() {
    if (this.channel) {
      for (const tag of this.consumers) {
        await this.channel.cancel(tag)
      }
      await this.channel.close()
    }
    if (this.connection) {
      await this.connection.close()
    }
  }
}
