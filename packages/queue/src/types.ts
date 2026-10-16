import 'reflect-metadata'
import { createToken, JOB_META } from '@forinda/kickjs'
import type { QueueService } from './queue.service'

/**
 * Options for configuring the QueueAdapter. Give `redis` for the built-in
 * BullMQ runner, or `provider` for any other backend (RabbitMQ, Kafka, your
 * own `QueueProvider`).
 */
export type QueueAdapterOptions = QueueAdapterCommon &
  (
    | {
        /** Redis connection for the built-in BullMQ runner (needs `bullmq` + `ioredis`). */
        redis: { host: string; port: number; password?: string }
        provider?: undefined
      }
    | {
        /** Any queue backend — `new RabbitMQProvider(url)`, `new KafkaProvider(...)`, or your own. */
        provider: QueueProvider
        redis?: undefined
      }
  )

interface QueueAdapterCommon {
  /** Queue names to pre-create (optional — queues are also created on-demand) */
  queues?: string[]
  /** Default worker concurrency (default: 1) */
  concurrency?: number
  /**
   * `false` starts no workers: this process only dispatches (an API server
   * whose jobs run in a separate worker process). `@Job` classes may still
   * be imported — their handlers just don't run here. Default `true`.
   */
  workers?: boolean
  /**
   * @deprecated No effect. Queues and their jobs are in the DevTools
   * **Queues** tab, which needs nothing from this adapter but itself.
   */
  panel?: boolean
}

/** DI token for resolving the QueueService from the container. */
export const QUEUE_MANAGER = createToken<QueueService>('kick/queue/Manager')

/**
 * Abstract interface for queue providers.
 * Implement this to use a different queue backend (RabbitMQ, SQS, Kafka, etc.)
 * while keeping the @Job/@Process decorators working.
 *
 * @example
 * ```ts
 * class RabbitMQProvider implements QueueProvider {
 *   async addJob(queue, name, data) { ... }
 *   async createWorker(queue, processor) { ... }
 *   async shutdown() { ... }
 * }
 *
 * QueueAdapter({ provider: new RabbitMQProvider(amqpUrl) })
 * ```
 */
export interface QueueProvider {
  /** Add a job to a queue */
  addJob(queue: string, name: string, data: any, opts?: any): Promise<any>
  /** Add multiple jobs to a queue */
  addBulk?(queue: string, jobs: Array<{ name: string; data: any; opts?: any }>): Promise<any[]>
  /** Create a worker that processes jobs from a queue */
  createWorker(
    queue: string,
    /** Resolves with the handler's return value — store it where your backend keeps results. */
    processor: (job: { name: string; data: any; id?: string }) => Promise<unknown>,
    concurrency?: number,
  ): any
  /** Get or create a queue by name */
  getQueue?(name: string): any
  /**
   * Check the backend is reachable — reject (or hang) when it isn't. The
   * adapter's `onHealthCheck()` calls it for `/health/ready`; a provider
   * without one reports `up`.
   */
  ping?(): Promise<unknown>
  /** Graceful shutdown — close all workers and queues */
  shutdown(): Promise<void>
}

/**
 * Metadata keys for the job decorators. `@Job` / `@Process` live in
 * `@forinda/kickjs` now; the keys are unchanged.
 */
export const QUEUE_METADATA = JOB_META

export type { ProcessDefinition } from '@forinda/kickjs'
