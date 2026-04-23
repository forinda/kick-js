import 'reflect-metadata'
import { createToken } from '@forinda/kickjs'
import type { QueueService } from './queue.service'

/** Options for configuring the QueueAdapter */
export interface QueueAdapterOptions {
  /** Redis connection configuration */
  redis: {
    host: string
    port: number
    password?: string
  }
  /** Queue names to pre-create (optional — queues are also created on-demand) */
  queues?: string[]
  /** Default worker concurrency (default: 1) */
  concurrency?: number
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
    processor: (job: { name: string; data: any; id?: string }) => Promise<void>,
    concurrency?: number,
  ): any
  /** Get or create a queue by name */
  getQueue?(name: string): any
  /** Graceful shutdown — close all workers and queues */
  shutdown(): Promise<void>
}

/** Metadata keys for queue decorators */
export const QUEUE_METADATA = {
  JOB: Symbol('queue:job'),
  PROCESS: Symbol('queue:process'),
} as const

/** Metadata stored by @Process decorator */
export interface ProcessDefinition {
  /** Method name on the controller class */
  handlerName: string
  /** Job name to handle (undefined = handle all jobs in the queue) */
  jobName?: string
}

/** Global registry of @Job-decorated classes */
export const jobRegistry = new Set<any>()
