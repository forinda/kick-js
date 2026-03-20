import type { QueueProvider } from '../types'

/**
 * Kafka queue provider — uses KafkaJS.
 * Requires: `pnpm add kafkajs`
 */
export class KafkaProvider implements QueueProvider {
  private kafka: any = null
  private producer: any = null
  private consumers: any[] = []

  constructor(
    private config: {
      brokers: string[]
      clientId?: string
      groupId?: string
    },
  ) {}

  private async ensureProducer() {
    if (!this.producer) {
      const { Kafka } = require('kafkajs')
      this.kafka = new Kafka({
        clientId: this.config.clientId ?? 'kickjs-app',
        brokers: this.config.brokers,
      })
      this.producer = this.kafka.producer()
      await this.producer.connect()
    }
    return this.producer
  }

  async addJob(queue: string, name: string, data: any, _opts?: any) {
    const producer = await this.ensureProducer()
    await producer.send({
      topic: queue,
      messages: [
        {
          key: name,
          value: JSON.stringify({ name, data, timestamp: Date.now() }),
        },
      ],
    })
    return { topic: queue, name }
  }

  async addBulk(queue: string, jobs: Array<{ name: string; data: any; opts?: any }>) {
    const producer = await this.ensureProducer()
    await producer.send({
      topic: queue,
      messages: jobs.map((j) => ({
        key: j.name,
        value: JSON.stringify({ name: j.name, data: j.data, timestamp: Date.now() }),
      })),
    })
    return jobs.map((j) => ({ topic: queue, name: j.name }))
  }

  createWorker(
    queue: string,
    processor: (job: { name: string; data: any; id?: string }) => Promise<void>,
    _concurrency?: number,
  ) {
    if (!this.kafka) {
      const { Kafka } = require('kafkajs')
      this.kafka = new Kafka({
        clientId: this.config.clientId ?? 'kickjs-app',
        brokers: this.config.brokers,
      })
    }

    const consumer = this.kafka.consumer({
      groupId: this.config.groupId ?? `kickjs-${queue}`,
    })

    this.consumers.push(consumer)
    ;(async () => {
      await consumer.connect()
      await consumer.subscribe({ topic: queue, fromBeginning: false })
      await consumer.run({
        eachMessage: async ({ message }: any) => {
          const parsed = JSON.parse(message.value.toString())
          await processor({
            name: parsed.name,
            data: parsed.data,
            id: message.offset,
          })
        },
      })
    })()
  }

  getQueue(name: string) {
    return { name, type: 'kafka' }
  }

  async shutdown() {
    for (const consumer of this.consumers) {
      await consumer.disconnect()
    }
    if (this.producer) {
      await this.producer.disconnect()
    }
  }
}
